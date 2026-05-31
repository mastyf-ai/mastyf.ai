/**
 * Stable agent + session identity for reputation, chain detection, and sandbox tiers.
 */
import { createHash } from 'crypto';

export interface AgentContext {
  agentId: string;
  sessionId: string;
  userId?: string;
  clientId?: string;
}

function hashId(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Resolve agent/session from MCP _meta, OAuth claims, or fallbacks. */
export function resolveAgentContext(params: {
  meta?: Record<string, unknown>;
  authSub?: string;
  authTenant?: string;
  serverName: string;
  fallbackSessionKey?: string;
}): AgentContext {
  const meta = params.meta ?? {};
  const auth = meta.auth as Record<string, unknown> | undefined;
  const guardian = meta.guardian as Record<string, unknown> | undefined;

  const userId =
    (guardian?.userId as string | undefined)
    ?? (auth?.sub as string | undefined)
    ?? params.authSub;

  const clientId =
    (guardian?.clientId as string | undefined)
    ?? (meta.clientId as string | undefined)
    ?? 'mcp-client';

  const sessionId =
    (guardian?.sessionId as string | undefined)
    ?? (meta.sessionId as string | undefined)
    ?? params.fallbackSessionKey
    ?? hashId(`${params.serverName}:${clientId}:${Date.now()}`);

  const agentId =
    (guardian?.agentId as string | undefined)
    ?? (meta.agentId as string | undefined)
    ?? (userId ? hashId(`agent:${userId}:${clientId}`) : hashId(`agent:${clientId}:${params.serverName}`));

  return { agentId, sessionId, userId, clientId };
}
