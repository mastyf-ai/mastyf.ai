import type {
  ToolDefinition, ToolScanResult, ScanStatus, Issue, ServerScanResult
} from "./types.js";
import { runRegexScan } from "./regex-scanner.js";
import { runSchemaScan } from "./schema-scanner.js";
import { runSemanticScan, type SemanticScanOptions } from "./semantic-scanner.js";
import { tryAcquireSemanticSlot, releaseSemanticSlot, semanticQueueMax, semanticPerTenantMax } from "./semantic-queue.js";
import { isCoreSemanticCircuitOpen, tryBeginCoreSemanticScan, abortCoreSemanticProbe } from "./semantic-circuit-breaker.js";
import { isCoreLocalSemanticEnabled, runLocalSemanticFallback } from "./local-semantic-fallback.js";
import { runArgumentScan } from "./argument-scanner.js";
import { getLlmConfig } from "./config/llm-config.js";

export interface ScanEngineOptions {
  /** TR39 confusables before offline regex (default: true). */
  unicodeStrict?: boolean;
  semantic?: SemanticScanOptions & {
    // Run semantic only if regex/schema already fired (default: false for full coverage)
    onlyOnHits?: boolean;
    // Minimum confidence to report a semantic issue (default: 0.7)
    confidenceThreshold?: number;
  };
  /** Optional tenant id for per-tenant semantic queue caps */
  tenantId?: string;
  // Skip layers entirely
  skipRegex?: boolean;
  skipSchema?: boolean;
  skipSemantic?: boolean;
}

function computeStatus(issues: Issue[]): ScanStatus {
  if (issues.some(i => i.severity === "critical")) return "critical";
  if (issues.some(i => i.severity === "warning")) return "warning";
  return "clean";
}

const REGEX_TO_SEMANTIC_CATEGORY: Record<string, string> = {
  "cross-tool": "cross-tool-chaining",
  "privilege-escalation": "privilege-escalation",
  "exfiltration": "exfiltration",
  "stealth": "stealth",
  "injection": "prompt-injection",
  "shell": "shell-injection",
  "ssrf": "ssrf",
  "path": "path-traversal",
};

function deduplicateIssues(issues: Issue[]): Issue[] {
  const semanticCategories = new Set(
    issues.filter((i) => i.layer === "semantic").map((i) => i.category),
  );
  return issues.filter((i) => {
    if (i.layer === "argument" || i.layer === "semantic") return true;
    if (i.layer !== "regex" && i.layer !== "schema") return true;
    const mapped = REGEX_TO_SEMANTIC_CATEGORY[i.category] ?? i.category;
    return !semanticCategories.has(mapped);
  });
}

const DEFAULT_MAX_TOOLS_PER_SCAN = 200;

function scanToolTimeoutMs(): number {
  const explicit = parseInt(process.env["MASTYF_AI_SCAN_TOOL_TIMEOUT_MS"] || "", 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return getLlmConfig().timeoutMs + 5000;
}

function scanServerBudgetMs(): number {
  const n = parseInt(process.env["MASTYF_AI_SCAN_SERVER_BUDGET_MS"] || "300000", 10);
  return Number.isFinite(n) && n > 0 ? n : 300_000;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toolScanTimeoutResult(toolName: string, timeoutMs: number): ToolScanResult {
  return {
    toolName,
    status: "warning",
    issues: [{
      id: "MCPG-META-004",
      layer: "semantic",
      severity: "info",
      category: "timeout",
      message: `Tool scan exceeded ${timeoutMs}ms budget`,
      evidence: toolName,
      confidence: 1.0,
    }],
    layers: {
      regex: { ran: false, durationMs: 0 },
      schema: { ran: false, durationMs: 0 },
      semantic: { ran: false, durationMs: 0, skipped: "tool scan budget exceeded" },
    },
  };
}

function scanConcurrency(): number {
  const n = parseInt(process.env["MASTYF_AI_SCAN_CONCURRENCY"] || "32", 10);
  return Number.isFinite(n) && n > 0 ? n : 32;
}

export async function scanTool(
  tool: ToolDefinition,
  options: ScanEngineOptions = {}
): Promise<ToolScanResult> {
  const testDelayMs = parseInt(process.env["MASTYF_AI_SCAN_TEST_DELAY_MS"] || "0", 10);
  if (testDelayMs > 0) {
    await new Promise((r) => setTimeout(r, testDelayMs));
  }

  const confidenceThreshold = options.semantic?.confidenceThreshold ?? 0.7;
  const onlyOnHits = options.semantic?.onlyOnHits ?? false;

  let regexIssues: Issue[] = [];
  let schemaIssues: Issue[] = [];
  let semanticIssues: Issue[] = [];

  const timings = {
    regex: { ran: false, durationMs: 0 },
    schema: { ran: false, durationMs: 0 },
    semantic: { ran: false, durationMs: 0, skipped: undefined as string | undefined },
  };

  // ── LAYERS 1+2: REGEX + SCHEMA (parallel when both run) ─────────────────────
  const runRegex = !options.skipRegex;
  const runSchema = !options.skipSchema && Boolean(tool.inputSchema);

  if (runRegex && runSchema) {
    const t0 = performance.now();
    const [regex, schema] = await Promise.all([
      Promise.resolve(runRegexScan(tool, { unicodeStrict: options.unicodeStrict })),
      Promise.resolve(runSchemaScan(tool)),
    ]);
    regexIssues = regex;
    schemaIssues = schema;
    const elapsed = Math.round(performance.now() - t0);
    timings.regex = { ran: true, durationMs: elapsed };
    timings.schema = { ran: true, durationMs: elapsed };
  } else {
    if (runRegex) {
      const t0 = performance.now();
      regexIssues = runRegexScan(tool, { unicodeStrict: options.unicodeStrict });
      timings.regex = { ran: true, durationMs: Math.round(performance.now() - t0) };
    }
    if (runSchema) {
      const t0 = performance.now();
      schemaIssues = runSchemaScan(tool);
      timings.schema = { ran: true, durationMs: Math.round(performance.now() - t0) };
    }
  }

  // ── LAYER 3: SEMANTIC ───────────────────────────────────────────────────────
  const priorHits = [...regexIssues, ...schemaIssues]
    .filter(i => i.severity !== "info");

  const shouldRunSemantic = !options.skipSemantic && (
    !onlyOnHits || priorHits.length > 0
  );

  if (shouldRunSemantic) {
    if (isCoreSemanticCircuitOpen()) {
      const t0 = performance.now();
      if (isCoreLocalSemanticEnabled()) {
        semanticIssues = runLocalSemanticFallback(tool).filter(
          (i) => i.layer !== "semantic" || i.confidence >= confidenceThreshold,
        );
      }
      timings.semantic = {
        ran: semanticIssues.length > 0,
        durationMs: Math.round(performance.now() - t0),
        skipped: "circuit open — local fallback",
      };
    } else if (!tryBeginCoreSemanticScan()) {
      timings.semantic = {
        ran: false,
        durationMs: 0,
        skipped: "circuit half-open — probe in flight",
      };
    } else if (!tryAcquireSemanticSlot(options.tenantId)) {
      abortCoreSemanticProbe();
      const cap = options.tenantId
        ? `per-tenant cap (${semanticPerTenantMax()})`
        : `global queue cap (${semanticQueueMax()})`;
      timings.semantic = {
        ran: false,
        durationMs: 0,
        skipped: cap,
      };
    } else {
      try {
        const t0 = performance.now();
        const rawSemantic = await runSemanticScan(
          tool,
          priorHits,
          {
            ...(options.semantic ?? {}),
            onlyOnHits,
            alwaysRun: !onlyOnHits,
          }
        );
        const skipMeta = rawSemantic.find((i) => i.category === "configuration" || i.category === "error");
        if (skipMeta && skipMeta.layer === "semantic") {
          timings.semantic = {
            ran: false,
            durationMs: Math.round(performance.now() - t0),
            skipped: skipMeta.message,
          };
          semanticIssues = rawSemantic.filter((i) => i.category !== "configuration" && i.category !== "error");
        } else {
          semanticIssues = rawSemantic.filter(
            i => i.layer !== "semantic" || i.confidence >= confidenceThreshold
          );
          timings.semantic = { ran: true, durationMs: Math.round(performance.now() - t0), skipped: undefined };
        }
      } finally {
        releaseSemanticSlot(options.tenantId);
      }
    }
  } else if (options.skipSemantic) {
    timings.semantic = { ran: false, durationMs: 0, skipped: "explicitly disabled" };
  } else {
    timings.semantic = { ran: false, durationMs: 0, skipped: "no regex/schema hits (onlyOnHits=true)" };
  }

  const allIssues = deduplicateIssues([
    ...regexIssues, ...schemaIssues, ...semanticIssues
  ]);

  return {
    toolName: tool.name,
    status: computeStatus(allIssues),
    issues: allIssues,
    layers: timings,
  };
}

export interface ToolCallScanResult extends ToolScanResult {
  argumentIssues: Issue[];
}

/**
 * Full tool-call evaluation — scans both the tool definition (descriptions,
 * schemas, semantics) AND runtime arguments for SQL/NoSQL injection,
 * boundary evasion, credential leaks, and shell obfuscation.
 *
 * Use scanTool() for server registration-time scanning (definitions only).
 * Use scanToolCall() for runtime call-time evaluation (definitions + args).
 */
export async function scanToolCall(
  tool: ToolDefinition,
  args?: Record<string, unknown>,
  options: ScanEngineOptions = {},
): Promise<ToolCallScanResult> {
  // ── Definition scan (existing layers) ────────────────────────────
  const defResult = await scanTool(tool, options);

  // ── Argument scan (runtime layer) ─────────────────────────────────
  let rawArgumentIssues: Issue[] = [];
  if (args && !options.skipRegex) {
    const argResult = runArgumentScan(args, tool.name);
    rawArgumentIssues = argResult.issues;
  }

  const allIssues = deduplicateIssues([
    ...defResult.issues,
    ...rawArgumentIssues,
  ]);
  const argumentIssues = allIssues.filter((i) => i.layer === "argument");

  return {
    ...defResult,
    status: computeStatus(allIssues),
    issues: allIssues,
    argumentIssues,
  };
}

export { runArgumentScan } from "./argument-scanner.js";

export async function scanServer(
  serverName: string,
  tools: ToolDefinition[],
  transport: "stdio" | "http" | "sse" = "stdio",
  options: ScanEngineOptions = {}
): Promise<ServerScanResult> {
  const capped = tools.slice(0, DEFAULT_MAX_TOOLS_PER_SCAN);
  const toolTimeoutMs = scanToolTimeoutMs();
  const serverBudgetMs = scanServerBudgetMs();
  const startedAt = Date.now();
  const toolResults: ToolScanResult[] = [];
  let truncated: ServerScanResult["truncated"];
  let budgetExceeded = false;

  const limit = scanConcurrency();
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < capped.length) {
      if (budgetExceeded) return;
      if (Date.now() - startedAt >= serverBudgetMs) {
        budgetExceeded = true;
        truncated = {
          reason: "server scan budget exceeded",
          budgetMs: serverBudgetMs,
          scanned: toolResults.filter(Boolean).length,
          total: capped.length,
        };
        return;
      }
      const i = idx++;
      const tool = capped[i]!;
      try {
        toolResults[i] = await withTimeout(
          scanTool(tool, options),
          toolTimeoutMs,
          `scanTool(${tool.name})`,
        );
      } catch {
        toolResults[i] = toolScanTimeoutResult(tool.name, toolTimeoutMs);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, capped.length) }, () => worker()),
  );

  const completed = toolResults.filter(Boolean);
  const summary = {
    total: completed.length,
    clean: completed.filter(r => r.status === "clean").length,
    warnings: completed.filter(r => r.status === "warning").length,
    critical: completed.filter(r => r.status === "critical").length,
  };

  const serverStatus =
    summary.critical > 0 ? "critical" :
    summary.warnings > 0 ? "warning" : "clean";

  return {
    serverName,
    transport,
    scannedAt: new Date().toISOString(),
    status: serverStatus,
    tools: completed,
    summary,
    ...(truncated ? { truncated } : {}),
  };
}