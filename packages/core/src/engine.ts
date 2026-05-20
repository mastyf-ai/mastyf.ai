import type {
  ToolDefinition, ToolScanResult, ScanStatus, Issue, ServerScanResult
} from "./types.js";
import { runRegexScan } from "./regex-scanner.js";
import { runSchemaScan } from "./schema-scanner.js";
import { runSemanticScan, type SemanticScanOptions } from "./semantic-scanner.js";

export interface ScanEngineOptions {
  semantic?: SemanticScanOptions & {
    // Run semantic only if regex/schema already fired (default: false for full coverage)
    onlyOnHits?: boolean;
    // Minimum confidence to report a semantic issue (default: 0.7)
    confidenceThreshold?: number;
  };
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
    if (i.layer !== "regex" && i.layer !== "schema") return true;
    const mapped = REGEX_TO_SEMANTIC_CATEGORY[i.category] ?? i.category;
    return !semanticCategories.has(mapped);
  });
}

const DEFAULT_MAX_TOOLS_PER_SCAN = 200;

function scanConcurrency(): number {
  const n = parseInt(process.env["MCP_GUARDIAN_SCAN_CONCURRENCY"] || "32", 10);
  return Number.isFinite(n) && n > 0 ? n : 32;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function scanTool(
  tool: ToolDefinition,
  options: ScanEngineOptions = {}
): Promise<ToolScanResult> {
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
      Promise.resolve(runRegexScan(tool)),
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
      regexIssues = runRegexScan(tool);
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
    const t0 = performance.now();
    const rawSemantic = await runSemanticScan(
      tool,
      priorHits,
      options.semantic ?? {}
    );
    semanticIssues = rawSemantic.filter(
      i => i.layer !== "semantic" || i.confidence >= confidenceThreshold
    );
    timings.semantic = { ran: true, durationMs: Math.round(performance.now() - t0), skipped: undefined };
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

export async function scanServer(
  serverName: string,
  tools: ToolDefinition[],
  transport: "stdio" | "http" | "sse" = "stdio",
  options: ScanEngineOptions = {}
): Promise<ServerScanResult> {
  const capped = tools.slice(0, DEFAULT_MAX_TOOLS_PER_SCAN);
  const toolResults = await mapWithConcurrency(
    capped,
    scanConcurrency(),
    (tool) => scanTool(tool, options),
  );

  const summary = {
    total: toolResults.length,
    clean: toolResults.filter(r => r.status === "clean").length,
    warnings: toolResults.filter(r => r.status === "warning").length,
    critical: toolResults.filter(r => r.status === "critical").length,
  };

  const serverStatus =
    summary.critical > 0 ? "critical" :
    summary.warnings > 0 ? "warning" : "clean";

  return {
    serverName,
    transport,
    scannedAt: new Date().toISOString(),
    status: serverStatus,
    tools: toolResults,
    summary,
  };
}