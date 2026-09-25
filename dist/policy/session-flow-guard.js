import { evaluatePathGuard, extractPathArgumentValues } from './path-guard.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { appendFlowEventSync, getFlowHistorySync, recordSensitiveResponseAccess, resetSessionFlowStore, } from './session-flow-store.js';
import { snapshotAuditArguments } from '../utils/audit-args-snapshot.js';
import { fingerprintArguments } from './loop-anomaly-detector.js';
import { globalSessionTaintTracker } from './difc/index.js';
export { recordSensitiveResponseAccess, resetSessionFlowStore as resetSessionFlowHistory };
export { evaluateLoopAnomalyGuard } from './loop-anomaly-detector.js';
const SENSITIVE_READ_TOOLS = new Set([
    'read_file',
    'read_text_file',
    'read',
    'get_file_contents',
    'cat',
    'head',
    'tail',
    'list_directory',
    'list_files',
]);
const EXFIL_TOOL_HINTS = /\b(?:webhook|callback|post|upload|send|forward|notify|http_request|fetch_url|transmit)\b/i;
const EXFIL_TOOL_NAMES = new Set([
    'http_request',
    'post_webhook',
    'send_message',
    'notify',
    'upload',
    'send_email',
]);
const NON_EXFIL_TOOLS = new Set([
    ...SENSITIVE_READ_TOOLS,
    'puppeteer_navigate',
    'puppeteer_screenshot',
    'search',
    'search_files',
    'query',
    'echo',
]);
const EXFIL_BODY_HINTS = /\b(?:previous|prior|last|result|output|response|file\s+contents|data\s+from)\b/i;
export function flowSessionKey(ctx) {
    const tenant = ctx.tenantId || process.env['MASTYF_AI_TENANT_ID'] || 'default';
    const sub = ctx.agentIdentity?.sub || ctx.agentIdentity?.clientId || 'anon';
    return `${tenant}:${ctx.serverName}:${sub}`;
}
function argsIndicateSensitiveRead(args) {
    if (!args)
        return false;
    const paths = extractPathArgumentValues(args);
    if (paths.length > 0) {
        const check = evaluatePathGuard(paths);
        if (check.block)
            return true;
    }
    const blob = walkStringLeaves(args)
        .map((l) => l.value)
        .join('\n');
    return /\b(?:\/etc\/passwd|\.env|\.ssh\/|id_rsa|credentials|serviceaccount\/token|\/proc\/|\/var\/log)\b/i.test(blob);
}
function isDataAccessTool(toolName, args) {
    if (!SENSITIVE_READ_TOOLS.has(toolName))
        return false;
    if (!args)
        return false;
    return extractPathArgumentValues(args).length > 0 || walkStringLeaves(args).length > 0;
}
function isExfilTool(toolName, args) {
    const lower = toolName.toLowerCase();
    if (NON_EXFIL_TOOLS.has(lower))
        return false;
    if (EXFIL_TOOL_NAMES.has(lower))
        return true;
    if (EXFIL_TOOL_HINTS.test(lower))
        return true;
    if (!args)
        return false;
    const blob = JSON.stringify(args);
    if (EXFIL_TOOL_HINTS.test(blob))
        return true;
    if (EXFIL_BODY_HINTS.test(blob) && /https?:\/\//i.test(blob))
        return true;
    return false;
}
/** Record a tool call for subsequent cross-call chain detection. */
export function recordSessionToolCall(ctx) {
    const key = flowSessionKey(ctx);
    const sensitiveRead = SENSITIVE_READ_TOOLS.has(ctx.toolName) && argsIndicateSensitiveRead(ctx.arguments);
    const dataAccess = isDataAccessTool(ctx.toolName, ctx.arguments);
    appendFlowEventSync(key, {
        toolName: ctx.toolName,
        sensitiveRead,
        dataAccess,
        at: Date.now(),
        argumentsSnapshot: snapshotAuditArguments(ctx.arguments),
        argFingerprint: fingerprintArguments(ctx.arguments),
        tokens: ctx.requestTokens ?? 0,
    });
}
/**
 * Block when a prior sensitive read or response DLP hit is followed by an exfil-capable tool call,
 * or when DIFC dynamic taint tracking detects cross-tool data propagation to an egress sink.
 */
export function evaluateSessionFlowGuard(ctx) {
    const key = flowSessionKey(ctx);
    // 1. Precise DIFC dynamic taint evaluation
    const difcResult = globalSessionTaintTracker.evaluateDIFC({
        sessionKey: key,
        toolName: ctx.toolName,
        args: ctx.arguments,
    });
    if (!difcResult.allowed && difcResult.violation) {
        return {
            action: 'block',
            rule: 'difc-exfiltration-prevented',
            reason: difcResult.violation.reason,
        };
    }
    // 2. Heuristic multi-call sequence fallback
    if (!isExfilTool(ctx.toolName, ctx.arguments)) {
        return null;
    }
    const history = getFlowHistorySync(key);
    const prior = history.find((e) => e.sensitiveRead || e.dataAccess);
    if (!prior)
        return null;
    return {
        action: 'block',
        rule: 'session-flow-exfil-chain',
        reason: `Multi-call exfil chain: data access via '${prior.toolName}' then exfil '${ctx.toolName}'`,
    };
}
//# sourceMappingURL=session-flow-guard.js.map