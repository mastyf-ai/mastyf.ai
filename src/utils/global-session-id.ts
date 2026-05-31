/**
 * Resolve a stable global session id for cross-MCP fleet chain correlation (A1).
 */
import type { IncomingHttpHeaders } from 'http';

export interface GlobalSessionInput {
  agentId?: string;
  mcpSessionId?: string;
  requestId: string;
  meta?: Record<string, unknown>;
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}

function headerOne(
  headers: GlobalSessionInput['headers'],
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const v = headers[name];
  if (!v) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

function metaSessionId(meta?: Record<string, unknown>): string | undefined {
  if (!meta) return undefined;
  const direct = meta.sessionId ?? meta.globalSessionId;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const guardian = meta.guardian as Record<string, unknown> | undefined;
  if (guardian && typeof guardian.sessionId === 'string' && guardian.sessionId.trim()) {
    return guardian.sessionId.trim();
  }
  return undefined;
}

/** Stable key spanning tool calls and MCP servers for fleet chain graphs. */
export function resolveGlobalSessionId(input: GlobalSessionInput): string {
  const fromHeader =
    headerOne(input.headers, 'x-guardian-global-session')
    ?? headerOne(input.headers, 'x-mcp-session-id');
  if (fromHeader) return fromHeader;

  const fromMeta = metaSessionId(input.meta);
  if (fromMeta) return fromMeta;

  if (input.agentId && input.mcpSessionId) {
    return `agent:${input.agentId}:mcp:${input.mcpSessionId}`;
  }
  if (input.agentId) return `agent:${input.agentId}`;
  if (input.mcpSessionId) return `mcp:${input.mcpSessionId}`;

  return `req:${input.requestId}`;
}

export function fleetChainBlockConfidenceThreshold(): number {
  const raw = process.env.GUARDIAN_FLEET_CHAIN_BLOCK_CONFIDENCE ?? '0.65';
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.65;
}

/** Per-request fallback ids cannot correlate cross-server chains. */
export function isEphemeralRequestSession(globalSessionId: string): boolean {
  return globalSessionId.startsWith('req:');
}

/** Derive agent id for fleet chain events when JWT sub is absent. */
export function deriveAgentIdForFleetChain(globalSessionId: string, agentId?: string): string {
  if (agentId?.trim()) return agentId.trim();
  if (globalSessionId.startsWith('agent:')) {
    const rest = globalSessionId.slice('agent:'.length);
    const mcpIdx = rest.indexOf(':mcp:');
    return mcpIdx >= 0 ? rest.slice(0, mcpIdx) : rest;
  }
  if (globalSessionId.startsWith('mcp:')) return globalSessionId.slice('mcp:'.length);
  return globalSessionId;
}
