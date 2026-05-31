/**
 * Proxy bridge for MCP lifecycle guard on all JSON-RPC methods.
 */
import { getAgenticContainer, isAgenticEnabled } from '../utils/agentic-container.js';
import type { McpMethod } from '../agentic/mcp-lifecycle/lifecycle-guard.js';
import { resolveAgentContext } from '../utils/agent-identity.js';
import { gateResourceOrPromptText } from '../utils/resource-prompt-security-gate.js';

const KNOWN_METHODS = new Set<string>([
  'initialize', 'initialized', 'ping',
  'tools/list', 'tools/call',
  'resources/list', 'resources/read', 'resources/templates/list',
  'prompts/list', 'prompts/get',
  'logging/setLevel',
  'notifications/initialized', 'notifications/cancelled',
]);

export function normalizeMcpMethod(method: string | undefined): McpMethod | null {
  if (!method || !KNOWN_METHODS.has(method)) return null;
  return method as McpMethod;
}

export interface LifecycleCheckResult {
  allowed: boolean;
  reason?: string;
  sessionId: string;
  agentId: string;
}

export function runMcpLifecyclePreCheck(params: {
  method: string;
  serverName: string;
  msg: Record<string, unknown>;
  authenticated: boolean;
  fallbackSessionKey?: string;
}): LifecycleCheckResult {
  const meta = (params.msg.params as Record<string, unknown> | undefined)?._meta as
    | Record<string, unknown>
    | undefined;
  const ctx = resolveAgentContext({
    meta,
    serverName: params.serverName,
    fallbackSessionKey: params.fallbackSessionKey,
  });

  const container = getAgenticContainer();
  if (!isAgenticEnabled() || !container?.lifecycleGuard) {
    return { allowed: true, sessionId: ctx.sessionId, agentId: ctx.agentId };
  }

  const mcpMethod = normalizeMcpMethod(params.method);
  if (!mcpMethod) {
    return { allowed: true, sessionId: ctx.sessionId, agentId: ctx.agentId };
  }

  if (mcpMethod === 'initialize') {
    const clientInfo = (params.msg.params as Record<string, unknown> | undefined)?.clientInfo as
      | { name?: string }
      | undefined;
    const session = container.lifecycleGuard.registerSession(
      clientInfo?.name ?? ctx.clientId ?? 'unknown',
      String((params.msg.params as Record<string, unknown> | undefined)?.protocolVersion ?? ''),
    );
    ctx.sessionId = session.sessionId;
  }

  const access = container.lifecycleGuard.checkAccess(
    ctx.sessionId,
    mcpMethod,
    params.authenticated,
  );

  if (!access.allowed) {
    container.lifecycleGuard.recordRequest(ctx.sessionId, mcpMethod, true, undefined, access.reason);
    return { allowed: false, reason: access.reason, sessionId: ctx.sessionId, agentId: ctx.agentId };
  }

  return { allowed: true, sessionId: ctx.sessionId, agentId: ctx.agentId };
}

export function recordMcpLifecycleRequest(params: {
  sessionId: string;
  method: string;
  blocked: boolean;
  toolName?: string;
  argsSummary?: string;
  latencyMs?: number;
  userId?: string;
}): void {
  const container = getAgenticContainer();
  const mcpMethod = normalizeMcpMethod(params.method);
  if (!container?.lifecycleGuard || !mcpMethod) return;
  container.lifecycleGuard.recordRequest(
    params.sessionId,
    mcpMethod,
    params.blocked,
    params.toolName,
    params.argsSummary,
    params.latencyMs,
    params.userId,
  );
}

/** Scan upstream resource/prompt JSON-RPC results before returning to client. */
export function gateMcpMethodResponse(params: {
  method: string;
  result: unknown;
}): { blocked: boolean; reason?: string; sanitized?: unknown } {
  if (params.method === 'resources/read' || params.method === 'prompts/get') {
    return gateResourceOrPromptText(params.method, params.result);
  }
  return { blocked: false };
}
