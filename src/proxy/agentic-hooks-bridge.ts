/**
 * Bridge from proxy transports to agentic container hooks.
 */
import type { IncomingHttpHeaders } from 'http';
import { getAgenticContainer, isAgenticEnabled } from '../utils/agentic-container.js';
import {
  recordAgenticAudit,
  runAgenticDeniedCallHooks,
  runAgenticPostCallHooks,
  runAgenticPreForwardHooks,
  type AgenticToolCallContext,
} from '../agentic/proxy-integration.js';

export type { AgenticToolCallContext };

export async function agenticPreForwardToolCall(
  serverName: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  ctx: AgenticToolCallContext | string,
  legacyAgentId?: string,
): Promise<{ blocked: boolean; sanitizedArgs?: Record<string, unknown>; reason?: string }> {
  const container = getAgenticContainer();
  if (!isAgenticEnabled() || !container || !args) {
    return { blocked: false };
  }
  return runAgenticPreForwardHooks(container, serverName, toolName, args, ctx, legacyAgentId);
}

export function agenticRecordDeniedToolCall(params: {
  serverName: string;
  sessionId: string;
  toolName: string;
  args?: Record<string, unknown>;
  latencyMs: number;
  blockRule?: string;
  blockReason?: string;
}): void {
  const container = getAgenticContainer();
  if (!isAgenticEnabled() || !container) return;
  runAgenticDeniedCallHooks(container, {
    sessionId: params.sessionId,
    method: 'tools/call',
    toolName: params.toolName,
    args: params.args,
    latencyMs: params.latencyMs,
    blocked: true,
    blockReason: params.blockReason,
    blockRule: params.blockRule,
    statusCode: 'blocked',
  });
}

export async function agenticRecordCompletedToolCall(params: {
  serverName: string;
  sessionId: string;
  toolName: string;
  args?: Record<string, unknown>;
  latencyMs: number;
  blocked: boolean;
  blockReason?: string;
  responseSize?: number;
  agentId?: string;
}): Promise<void> {
  const container = getAgenticContainer();
  if (!isAgenticEnabled() || !container) return;
  recordAgenticAudit(container, {
    sessionId: params.sessionId,
    method: 'tools/call',
    toolName: params.toolName,
    args: params.args,
    latencyMs: params.latencyMs,
    blocked: params.blocked,
    blockReason: params.blockReason,
    responseSize: params.responseSize ?? 0,
    statusCode: params.blocked ? 'blocked' : 'ok',
  });
  if (!params.blocked && params.args) {
    await runAgenticPostCallHooks(
      container,
      params.serverName,
      params.toolName,
      params.args,
      params.sessionId,
      params.latencyMs,
      true,
      params.agentId,
      params.responseSize,
    );
  }
}

/** Build session context for fleet chain correlation across MCP servers. */
export function buildAgenticToolCallContext(params: {
  requestId: string;
  agentId?: string;
  mcpSessionId?: string;
  meta?: Record<string, unknown>;
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>;
}): AgenticToolCallContext {
  return {
    requestId: params.requestId,
    agentId: params.agentId,
    mcpSessionId: params.mcpSessionId,
    meta: params.meta,
    headers: params.headers,
  };
}
