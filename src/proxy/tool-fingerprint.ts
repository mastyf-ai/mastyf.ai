/**
 * OWASP MCP03 rug-pull detection — canonical tools/list fingerprinting.
 */
import { createHash } from 'crypto';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import * as Metrics from '../utils/metrics.js';

export type ToolListEntry = {
  name?: string;
  description?: string;
  inputSchema?: unknown;
};

export type ToolFingerprintState = {
  fingerprint: string | null;
  blocked: boolean;
};

export function canonicalizeToolsList(tools: ToolListEntry[]): string {
  const canonical = JSON.stringify(
    tools
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  );
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function hashToolsFromResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools) || tools.length === 0) return null;
  return canonicalizeToolsList(tools as ToolListEntry[]);
}

export type RugPullMismatchHandler = (ctx: {
  serverName: string;
  tenantId: string;
  previousFingerprint: string;
  currentFingerprint: string;
  toolCount: number;
}) => void | Promise<void>;

/**
 * Update fingerprint from a tools/list payload (JSON-RPC response or notification).
 * Returns true if a new rug-pull mismatch was detected this call.
 */
export function applyToolFingerprint(
  state: ToolFingerprintState,
  tools: ToolListEntry[],
  ctx: {
    serverName: string;
    tenantId: string;
    logPrefix?: string;
    onMismatch?: RugPullMismatchHandler;
  },
): boolean {
  if (!tools.length) return false;
  const hash = canonicalizeToolsList(tools);
  const prefix = ctx.logPrefix ?? `[proxy:${ctx.serverName}]`;

  if (!state.fingerprint) {
    state.fingerprint = hash;
    Logger.debug(`${prefix} Tool fingerprint registered: ${hash} (${tools.length} tools)`);
    return false;
  }

  if (state.fingerprint === hash) return false;

  const prev = state.fingerprint;
  state.blocked = true;
  const alert = `${prefix} 🚨 RUG-PULL DETECTED (OWASP MCP03): tool definitions changed mid-session. Previous: ${prev}, New: ${hash}`;
  Logger.error(alert);
  StructuredLogger.info({
    event: 'rug_pull_detected' as const,
    serverName: ctx.serverName,
    previousFingerprint: prev,
    currentFingerprint: hash,
    toolCount: tools.length,
  });
  Metrics.rugpullDetectedTotal.inc(
    Metrics.withTenantMetricLabels({ server_name: ctx.serverName }, ctx.tenantId),
  );
  Metrics.recordProxyBlock(
    {
      server_name: ctx.serverName,
      block_reason: 'rug_pull',
      rule: 'tool-fingerprint-mismatch',
      tenant_id: ctx.tenantId,
    },
    'rug_pull',
  );
  void ctx.onMismatch?.({
    serverName: ctx.serverName,
    tenantId: ctx.tenantId,
    previousFingerprint: prev,
    currentFingerprint: hash,
    toolCount: tools.length,
  });
  return true;
}

export function applyToolFingerprintFromResult(
  state: ToolFingerprintState,
  result: unknown,
  ctx: Parameters<typeof applyToolFingerprint>[2],
): boolean {
  if (!result || typeof result !== 'object') return false;
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools) || tools.length === 0) return false;
  return applyToolFingerprint(state, tools as ToolListEntry[], ctx);
}
