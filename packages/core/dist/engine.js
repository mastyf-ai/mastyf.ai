import { runRegexScan } from "./regex-scanner.js";
import { runSchemaScan } from "./schema-scanner.js";
import { runSemanticScan } from "./semantic-scanner.js";
import { tryAcquireClusterSemanticSlot, releaseSemanticSlot, semanticQueueMax, semanticPerTenantMax } from "./semantic-queue.js";
import { tryAcquireScanSlot, releaseScanSlot, isRedisScanConcurrencyEnabled } from "./redis-scan-concurrency.js";
import { isCoreSemanticCircuitOpen, tryBeginCoreSemanticScan, abortCoreSemanticProbe } from "./semantic-circuit-breaker.js";
import { isCoreLocalSemanticEnabled, runLocalSemanticFallback } from "./local-semantic-fallback.js";
import { runArgumentScan } from "./argument-scanner.js";
import { resolveScanToolTimeoutMs } from "./scan-timeouts.js";
import { getMaxArgumentBytes, serializedArgumentBytes } from "./payload-limits.js";
function computeStatus(issues) {
    if (issues.some(i => i.severity === "critical"))
        return "critical";
    if (issues.some(i => i.severity === "warning"))
        return "warning";
    return "clean";
}
const CATEGORY_ALIASES = {
    "cross-tool": "cross-tool-chaining",
    "cross-tool-chaining": "cross-tool-chaining",
    "privilege-escalation": "privilege-escalation",
    exfiltration: "exfiltration",
    stealth: "stealth",
    injection: "prompt-injection",
    "prompt-injection": "prompt-injection",
    "identity-override": "identity-override",
    "goal-replacement": "goal-replacement",
    shell: "shell-injection",
    ssrf: "ssrf",
    path: "path-traversal",
    "path-traversal": "path-traversal",
};
const KNOWN_SEMANTIC_CATEGORIES = new Set(Object.values(CATEGORY_ALIASES));
function normalizeIssueCategory(category) {
    const key = category.toLowerCase().trim();
    if (CATEGORY_ALIASES[key])
        return CATEGORY_ALIASES[key];
    return key.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}
function semanticCategoryTokens(category) {
    return category
        .split(",")
        .map((c) => normalizeIssueCategory(c.trim()))
        .filter(Boolean);
}
function deduplicateIssues(issues) {
    const semanticCategories = new Set();
    for (const issue of issues.filter((i) => i.layer === "semantic")) {
        for (const token of semanticCategoryTokens(issue.category || "unknown")) {
            if (KNOWN_SEMANTIC_CATEGORIES.has(token)) {
                semanticCategories.add(token);
            }
            else if (token !== "unknown") {
                console.warn(`[engine] unknown semantic category "${token}" — not used for regex/schema dedup`);
            }
        }
    }
    return issues.filter((i) => {
        if (i.layer === "argument" || i.layer === "semantic")
            return true;
        if (i.layer !== "regex" && i.layer !== "schema")
            return true;
        const cat = normalizeIssueCategory(i.category || "unknown");
        return !semanticCategories.has(cat);
    });
}
const DEFAULT_MAX_TOOLS_PER_SCAN = 200;
const DEFAULT_SCAN_CONCURRENCY = 32;
let cachedScanConcurrency;
function getScanConcurrency() {
    if (cachedScanConcurrency === undefined) {
        const n = parseInt(process.env["MASTYF_AI_SCAN_CONCURRENCY"] || String(DEFAULT_SCAN_CONCURRENCY), 10);
        cachedScanConcurrency = Number.isFinite(n) && n > 0 ? n : DEFAULT_SCAN_CONCURRENCY;
    }
    return cachedScanConcurrency;
}
/** @internal */
export function resetScanConcurrencyCacheForTests() {
    cachedScanConcurrency = undefined;
}
function scanToolTimeoutMs() {
    return resolveScanToolTimeoutMs();
}
/** @internal Test hook */
export { resolveScanToolTimeoutMs } from "./scan-timeouts.js";
function scanServerBudgetMs() {
    const n = parseInt(process.env["MASTYF_AI_SCAN_SERVER_BUDGET_MS"] || "300000", 10);
    return Number.isFinite(n) && n > 0 ? n : 300_000;
}
async function withTimeout(fn, ms, label) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const result = await fn(controller.signal);
        if (controller.signal.aborted) {
            throw new Error(`${label} timed out after ${ms}ms`);
        }
        return result;
    }
    catch (err) {
        if (controller.signal.aborted) {
            throw new Error(`${label} timed out after ${ms}ms`);
        }
        throw err;
    }
    finally {
        clearTimeout(timer);
    }
}
async function acquireScanSlotWithWait(max, startedAt, budgetMs) {
    if (!isRedisScanConcurrencyEnabled())
        return true;
    while (Date.now() - startedAt < budgetMs) {
        if (await tryAcquireScanSlot(max))
            return true;
        await new Promise((r) => setTimeout(r, 25));
    }
    return false;
}
function toolScanTimeoutResult(toolName, timeoutMs) {
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
export async function scanTool(tool, options = {}) {
    const testDelayMs = parseInt(process.env["MASTYF_AI_SCAN_TEST_DELAY_MS"] || "0", 10);
    if (testDelayMs > 0) {
        await new Promise((r) => setTimeout(r, testDelayMs));
    }
    const confidenceThreshold = options.semantic?.confidenceThreshold ?? 0.7;
    const onlyOnHits = options.semantic?.onlyOnHits ?? false;
    let regexIssues = [];
    let schemaIssues = [];
    let semanticIssues = [];
    const timings = {
        regex: { ran: false, durationMs: 0 },
        schema: { ran: false, durationMs: 0 },
        semantic: { ran: false, durationMs: 0, skipped: undefined },
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
    }
    else {
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
    const shouldRunSemantic = !options.skipSemantic && (!onlyOnHits || priorHits.length > 0);
    if (shouldRunSemantic) {
        if (isCoreSemanticCircuitOpen()) {
            const t0 = performance.now();
            if (isCoreLocalSemanticEnabled()) {
                semanticIssues = runLocalSemanticFallback(tool).filter((i) => i.layer !== "semantic" || i.confidence >= confidenceThreshold);
            }
            timings.semantic = {
                ran: semanticIssues.length > 0,
                durationMs: Math.round(performance.now() - t0),
                skipped: "circuit open — local fallback",
            };
        }
        else if (!tryBeginCoreSemanticScan()) {
            timings.semantic = {
                ran: false,
                durationMs: 0,
                skipped: "circuit half-open — probe in flight",
            };
        }
        else if (!(await tryAcquireClusterSemanticSlot(options.tenantId))) {
            abortCoreSemanticProbe();
            const cap = options.tenantId
                ? `per-tenant cap (${semanticPerTenantMax()})`
                : `global queue cap (${semanticQueueMax()})`;
            timings.semantic = {
                ran: false,
                durationMs: 0,
                skipped: cap,
            };
        }
        else {
            try {
                const t0 = performance.now();
                const rawSemantic = await runSemanticScan(tool, priorHits, {
                    ...(options.semantic ?? {}),
                    onlyOnHits,
                    alwaysRun: !onlyOnHits,
                    abortSignal: options.abortSignal,
                });
                const skipMeta = rawSemantic.find((i) => (i.category === "configuration" || i.category === "error")
                    && i.severity !== "critical");
                if (skipMeta && skipMeta.layer === "semantic") {
                    timings.semantic = {
                        ran: false,
                        durationMs: Math.round(performance.now() - t0),
                        skipped: skipMeta.message,
                    };
                    semanticIssues = rawSemantic.filter((i) => i.severity === "critical" || (i.category !== "configuration" && i.category !== "error"));
                }
                else {
                    semanticIssues = rawSemantic.filter(i => i.layer !== "semantic" || i.confidence >= confidenceThreshold);
                    timings.semantic = { ran: true, durationMs: Math.round(performance.now() - t0), skipped: undefined };
                }
            }
            finally {
                releaseSemanticSlot(options.tenantId);
            }
        }
    }
    else if (options.skipSemantic) {
        timings.semantic = { ran: false, durationMs: 0, skipped: "explicitly disabled" };
    }
    else {
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
/**
 * Full tool-call evaluation — scans both the tool definition (descriptions,
 * schemas, semantics) AND runtime arguments for SQL/NoSQL injection,
 * boundary evasion, credential leaks, and shell obfuscation.
 *
 * Use scanTool() for server registration-time scanning (definitions only).
 * Use scanToolCall() for runtime call-time evaluation (definitions + args).
 */
export async function scanToolCall(tool, args, options = {}) {
    // ── Definition scan (existing layers) ────────────────────────────
    const defResult = await scanTool(tool, options);
    // ── Argument scan (runtime layer) ─────────────────────────────────
    let rawArgumentIssues = [];
    if (args) {
        const argBytes = serializedArgumentBytes(args);
        if (argBytes > getMaxArgumentBytes()) {
            rawArgumentIssues = [{
                    id: "MCPG-META-006",
                    layer: "argument",
                    severity: "critical",
                    category: "payload-limit",
                    message: `Tool arguments exceed ${getMaxArgumentBytes()} byte limit (${argBytes} bytes)`,
                    evidence: tool.name,
                    confidence: 1.0,
                }];
        }
        else if (!options.skipRegex) {
            const argResult = runArgumentScan(args, tool.name);
            rawArgumentIssues = argResult.issues;
        }
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
export async function scanServer(serverName, tools, transport = "stdio", options = {}) {
    const capped = tools.slice(0, DEFAULT_MAX_TOOLS_PER_SCAN);
    const toolTimeoutMs = scanToolTimeoutMs();
    const serverBudgetMs = scanServerBudgetMs();
    const startedAt = Date.now();
    const toolResults = [];
    let truncated;
    let budgetExceeded = false;
    const limit = getScanConcurrency();
    let idx = 0;
    async function worker() {
        while (idx < capped.length) {
            if (budgetExceeded)
                return;
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
            if (!(await acquireScanSlotWithWait(limit, startedAt, serverBudgetMs))) {
                budgetExceeded = true;
                truncated = {
                    reason: "cluster scan concurrency cap exceeded",
                    budgetMs: serverBudgetMs,
                    scanned: toolResults.filter(Boolean).length,
                    total: capped.length,
                };
                return;
            }
            const i = idx++;
            const tool = capped[i];
            try {
                toolResults[i] = await withTimeout((signal) => scanTool(tool, { ...options, abortSignal: signal }), toolTimeoutMs, `scanTool(${tool.name})`);
            }
            catch {
                toolResults[i] = toolScanTimeoutResult(tool.name, toolTimeoutMs);
            }
            finally {
                await releaseScanSlot();
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, capped.length) }, () => worker()));
    const completed = toolResults.filter(Boolean);
    const summary = {
        total: completed.length,
        clean: completed.filter(r => r.status === "clean").length,
        warnings: completed.filter(r => r.status === "warning").length,
        critical: completed.filter(r => r.status === "critical").length,
    };
    const serverStatus = summary.critical > 0 ? "critical" :
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
//# sourceMappingURL=engine.js.map