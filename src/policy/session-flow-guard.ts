/**
 * Per-session multi-call flow analysis — detects read-sensitive → exfil tool sequences.
 */
import { LRUCache } from 'lru-cache';
import type { CallContext, PolicyDecision } from './policy-types.js';
import { evaluatePathGuard, extractPathArgumentValues } from './path-guard.js';
import { walkStringLeaves } from './arg-leaf-walker.js';

const FLOW_WINDOW_MS = 5 * 60 * 1000;
const MAX_HISTORY = 24;

const SENSITIVE_READ_TOOLS = new Set([
  'read_file',
  'read_text_file',
  'read',
  'get_file_contents',
  'cat',
  'head',
  'tail',
]);

const EXFIL_TOOL_HINTS =
  /\b(?:webhook|callback|post|upload|send|forward|notify|http_request|fetch_url)\b/i;

const EXFIL_TOOL_NAMES = new Set([
  'http_request',
  'post_webhook',
  'send_message',
  'notify',
  'upload',
]);

/** Tools that may carry URLs but are not exfil endpoints. */
const NON_EXFIL_TOOLS = new Set([
  ...SENSITIVE_READ_TOOLS,
  'puppeteer_navigate',
  'puppeteer_screenshot',
  'search',
  'search_files',
  'query',
  'list_directory',
  'echo',
]);

interface FlowEvent {
  toolName: string;
  sensitiveRead: boolean;
  at: number;
}

const sessionHistory = new LRUCache<string, FlowEvent[]>({
  max: 20_000,
  ttl: FLOW_WINDOW_MS,
  updateAgeOnGet: true,
});

export function flowSessionKey(ctx: CallContext): string {
  const tenant = ctx.tenantId || process.env['GUARDIAN_TENANT_ID'] || 'default';
  const sub = ctx.agentIdentity?.sub || ctx.agentIdentity?.clientId || 'anon';
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
  return /\b(?:\/etc\/passwd|\.env|\.ssh\/|id_rsa|credentials|serviceaccount\/token|\/proc\/)\b/i.test(
    blob,
  );
}

function isExfilTool(toolName: string, args: Record<string, unknown> | undefined): boolean {
  const lower = toolName.toLowerCase();
  if (NON_EXFIL_TOOLS.has(lower)) return false;
  if (EXFIL_TOOL_NAMES.has(lower)) return true;
  if (EXFIL_TOOL_HINTS.test(lower)) return true;
  if (!args) return false;
  const blob = JSON.stringify(args);
  return EXFIL_TOOL_HINTS.test(blob);
}

/** Record a tool call for subsequent cross-call chain detection. */
export function recordSessionToolCall(ctx: CallContext): void {
  const key = flowSessionKey(ctx);
  const now = Date.now();
  const sensitiveRead =
    SENSITIVE_READ_TOOLS.has(ctx.toolName) && argsIndicateSensitiveRead(ctx.arguments);
  const history = sessionHistory.get(key) ?? [];
  history.push({ toolName: ctx.toolName, sensitiveRead, at: now });
  while (history.length > MAX_HISTORY) history.shift();
  sessionHistory.set(key, history);
}

/** Clear session history (tests / harness). */
export function resetSessionFlowHistory(): void {
  sessionHistory.clear();
}

/**
 * Block when a prior sensitive read in this session is followed by an exfil-capable tool call.
 */
export function evaluateSessionFlowGuard(ctx: CallContext): PolicyDecision | null {
  const key = flowSessionKey(ctx);
  const now = Date.now();
  const history = (sessionHistory.get(key) ?? []).filter((e) => now - e.at <= FLOW_WINDOW_MS);

  if (!isExfilTool(ctx.toolName, ctx.arguments)) {
    return null;
  }

  const priorSensitive = history.find((e) => e.sensitiveRead);
  if (!priorSensitive) return null;

  return {
    action: 'block',
    rule: 'session-flow-exfil-chain',
    reason: `Multi-call exfil chain: sensitive read via '${priorSensitive.toolName}' then '${ctx.toolName}'`,
  };
}
