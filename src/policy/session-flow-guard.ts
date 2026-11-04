/**
 * Per-session multi-call flow analysis — detects read-sensitive → exfil tool sequences.
 */
import type { CallContext, PolicyDecision } from './policy-types.js';
import { evaluatePathGuard, extractPathArgumentValues } from './path-guard.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import {
  appendFlowEventSync,
  getFlowHistorySync,
  recordSensitiveResponseAccess,
  resetSessionFlowStore,
} from './session-flow-store.js';
import { snapshotAuditArguments } from '../utils/audit-args-snapshot.js';
import { fingerprintArguments } from './loop-anomaly-detector.js';
import { checkDataFlow } from '../extensions/index.js';
import { classifyEgress } from './egress-classifier.js';
import { Logger } from '../utils/logger.js';

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

const EXFIL_TOOL_HINTS =
  /\b(?:webhook|callback|post|upload|send|forward|notify|http_request|fetch_url|transmit)\b/i;

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

const EXFIL_BODY_HINTS =
  /\b(?:previous|prior|last|result|output|response|file\s+contents|data\s+from)\b/i;

export function flowSessionKey(ctx: CallContext): string {
  const tenant = ctx.tenantId || process.env['MASTYF_AI_TENANT_ID'] || 'default';
  // Identity first; otherwise the MCP/transport session id so unrelated conversations on the same
  // server do not share one pooled history (a single "anon" bucket let one agent's read poison
  // every other agent's calls). Falls back to 'anon' when neither is available.
  const sub = ctx.agentIdentity?.sub || ctx.agentIdentity?.clientId || ctx.sessionId || 'anon';
  return `${tenant}:${ctx.serverName}:${sub}`;
}

function argsIndicateSensitiveRead(args: Record<string, unknown> | undefined): boolean {
  if (!args) return false;
  const paths = extractPathArgumentValues(args);
  if (paths.length > 0) {
    const check = evaluatePathGuard(paths);
    if (check.block) return true;
  }
  const blob = walkStringLeaves(args)
    .map((l) => l.value)
    .join('\n');
  return /\b(?:\/etc\/passwd|\.env|\.ssh\/|id_rsa|credentials|serviceaccount\/token|\/proc\/|\/var\/log)\b/i.test(
    blob,
  );
}

function isDataAccessTool(toolName: string, args: Record<string, unknown> | undefined): boolean {
  if (!SENSITIVE_READ_TOOLS.has(toolName)) return false;
  if (!args) return false;
  return extractPathArgumentValues(args).length > 0 || walkStringLeaves(args).length > 0;
}

function isExfilTool(toolName: string, args: Record<string, unknown> | undefined): boolean {
  const lower = toolName.toLowerCase();
  if (NON_EXFIL_TOOLS.has(lower)) return false;
  if (EXFIL_TOOL_NAMES.has(lower)) return true;
  if (EXFIL_TOOL_HINTS.test(lower)) return true;
  if (!args) return false;
  const blob = JSON.stringify(args);
  // Argument text alone ("send", "post", ...) is not egress: data only leaves when there is a destination.
  if (EXFIL_TOOL_HINTS.test(blob) && /https?:\/\//i.test(blob)) return true;
  if (EXFIL_BODY_HINTS.test(blob) && /https?:\/\//i.test(blob)) return true;
  return false;
}

/** Record a tool call for subsequent cross-call chain detection. */
export function recordSessionToolCall(ctx: CallContext): void {
  const key = flowSessionKey(ctx);
  const sensitiveRead =
    SENSITIVE_READ_TOOLS.has(ctx.toolName) && argsIndicateSensitiveRead(ctx.arguments);
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
 * or when an extension's data-flow check objects.
 */
export function evaluateSessionFlowGuard(ctx: CallContext): PolicyDecision | null {
  const key = flowSessionKey(ctx);

  // 1. Data-flow check from any extension
  const flowBlock = checkDataFlow({ sessionKey: key, toolName: ctx.toolName, args: ctx.arguments });
  if (flowBlock) {
    return { action: 'block', rule: flowBlock.rule, reason: flowBlock.reason };
  }

  // 2. Heuristic multi-call sequence fallback
  if (!isExfilTool(ctx.toolName, ctx.arguments)) {
    return null;
  }

  const history = getFlowHistorySync(key);
  // A confirmed-sensitive read (credential/system path, DLP hit) is strong evidence; a plain file read
  // is not, because ordinary agent work reads files and then calls APIs.
  const sensitivePrior = history.find((e) => e.sensitiveRead);
  const dataPrior = history.find((e) => e.dataAccess);
  if (!sensitivePrior && !dataPrior) return null;

  const egress = classifyEgress(ctx.toolName, ctx.arguments, { strict: !!sensitivePrior });
  // Bounded GET to a well-known read-only API cannot carry meaningful data out.
  if (egress === 'safe-read') return null;

  // Plain read followed by a message to a person/channel (no URL destination): allow but record it.
  // Content scanning (secrets-in-args, response DLP) still applies to the call itself.
  // Set MASTYF_AI_FLOW_STRICT_MESSAGING=true to restore the old block.
  if (!sensitivePrior && egress === 'messaging' && process.env['MASTYF_AI_FLOW_STRICT_MESSAGING'] !== 'true') {
    Logger.warn(
      `[SessionFlow] flagged-for-review: '${ctx.toolName}' after data access '${dataPrior?.toolName}' (session ${key})`,
    );
    return null;
  }

  const prior = sensitivePrior ?? dataPrior!;
  return {
    action: 'block',
    rule: 'session-flow-exfil-chain',
    reason: `Multi-call exfil chain: data access via '${prior.toolName}' then exfil '${ctx.toolName}'`,
  };
}
