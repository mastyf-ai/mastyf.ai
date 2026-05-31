/**
 * Unified MCP lifecycle + resource/prompt gating for all proxy transports.
 */
import { hasJsonRpcId, jsonRpcErrorBody } from './json-rpc-utils.js';
import {
  gateMcpMethodResponse,
  recordMcpLifecycleRequest,
  runMcpLifecyclePreCheck,
} from './mcp-lifecycle-bridge.js';

export interface McpPipelineSession {
  sessionId: string;
  agentId: string;
}

export type McpPrePipelineResult =
  | { blocked: false; session: McpPipelineSession; trackResponse?: boolean; requestMethod?: string }
  | { blocked: true; response: Record<string, unknown> };

const RESPONSE_METHODS = new Set(['resources/read', 'prompts/get']);

export function runMcpPrePipeline(params: {
  msg: Record<string, unknown>;
  serverName: string;
  authenticated: boolean;
  fallbackSessionKey?: string;
}): McpPrePipelineResult {
  const method = String(params.msg.method ?? '');
  if (!method) {
    return { blocked: false, session: { sessionId: params.fallbackSessionKey ?? 'anon', agentId: 'unknown' } };
  }

  const lifecycle = runMcpLifecyclePreCheck({
    method,
    serverName: params.serverName,
    msg: params.msg,
    authenticated: params.authenticated,
    fallbackSessionKey: params.fallbackSessionKey,
  });

  if (!lifecycle.allowed && hasJsonRpcId(params.msg.id)) {
    return {
      blocked: true,
      response: jsonRpcErrorBody(
        params.msg.id,
        -32001,
        lifecycle.reason ?? 'MCP lifecycle guard blocked request',
      ) as Record<string, unknown>,
    };
  }

  return {
    blocked: false,
    session: { sessionId: lifecycle.sessionId, agentId: lifecycle.agentId },
    trackResponse: RESPONSE_METHODS.has(method) && hasJsonRpcId(params.msg.id),
    requestMethod: RESPONSE_METHODS.has(method) ? method : undefined,
  };
}

export function applyMcpResponsePipeline(params: {
  method: string;
  result: unknown;
  sessionId: string;
  latencyMs?: number;
}): { blocked: boolean; reason?: string; result?: unknown } {
  const gate = gateMcpMethodResponse({ method: params.method, result: params.result });
  recordMcpLifecycleRequest({
    sessionId: params.sessionId,
    method: params.method,
    blocked: gate.blocked,
    latencyMs: params.latencyMs,
  });
  if (gate.blocked) {
    return { blocked: true, reason: gate.reason };
  }
  return { blocked: false, result: gate.sanitized ?? params.result };
}

export function mcpResponseBlockJson(
  id: string | number | null | undefined,
  reason: string,
): Record<string, unknown> {
  return jsonRpcErrorBody(id, -32002, reason ?? 'Resource/prompt blocked by MCP Guardian') as Record<
    string,
    unknown
  >;
}
