/**
 * Unified MCP lifecycle + resource/prompt gating for all proxy transports.
 */
import { hasJsonRpcId, jsonRpcErrorBody } from './json-rpc-utils.js';
import { validateMcpJsonRpcMessage } from '../validation/mcp-jsonrpc.js';
import { Logger } from '../utils/logger.js';
import {
  authorizePromptGet,
  authorizeResourceRead,
} from '../security-os/canonical-resource-guard.js';
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
  | { blocked: true; response?: Record<string, unknown>; code: number; reason: string };

const RESPONSE_METHODS = new Set(['resources/read', 'resources/subscribe', 'prompts/get']);

/**
 * Pre-dispatch authorization of the target a request names.
 *
 * `applyMcpResponsePipeline` gates what a server *returns*, but nothing gated
 * what a client *asked for*: a traversal URI or prompt name was normalized and
 * denied by `canonical-resource-guard` and then never consulted, so
 * `resources/read`/`prompts/get` reached the upstream server regardless. The
 * guard's own primitives are the authority here — this only routes them.
 *
 * `resources/subscribe` names a `uri` and was mediated and allow-listed without
 * ever being routed here, so `SubscriptionLifecycleManager.authorizeSubscription`
 * — a pure delegation to `authorizeResourceRead` — had no callers and a
 * traversal subscribe was never consulted at all.
 */
function authorizeRequestTarget(
  method: string,
  msg: Record<string, unknown>,
): { allowed: boolean; code: number; reason: string } | undefined {
  const requestParams = (msg.params ?? {}) as Record<string, unknown>;
  if (method === 'resources/read') {
    if (requestParams.uri === undefined) return undefined;
    const verdict = authorizeResourceRead(String(requestParams.uri));
    return {
      allowed: verdict.allowed,
      code: verdict.code ?? -32001,
      reason: verdict.reason ?? 'Resource access denied',
    };
  }
  if (method === 'resources/subscribe') {
    if (requestParams.uri === undefined) return undefined;
    const verdict = authorizeResourceRead(String(requestParams.uri));
    return {
      allowed: verdict.allowed,
      code: verdict.code ?? -32001,
      reason: verdict.reason ?? 'Subscription access denied',
    };
  }
  if (method === 'prompts/get') {
    if (requestParams.name === undefined) return undefined;
    const verdict = authorizePromptGet(requestParams.name, requestParams.arguments);
    return {
      allowed: verdict.allowed,
      code: verdict.code ?? -32001,
      reason: verdict.reason ?? 'Prompt access denied',
    };
  }
  return undefined;
}

export function runMcpPrePipeline(params: {
  msg: Record<string, unknown>;
  serverName: string;
  authenticated: boolean;
  fallbackSessionKey?: string;
}): McpPrePipelineResult {
  const rpcCheck = validateMcpJsonRpcMessage(params.msg);
  if (!rpcCheck.ok) {
    // Enforce regardless of `id`: a client that omits it must still be refused.
    // The error *body* still needs an id, because a notification is never answered.
    return {
      blocked: true,
      code: rpcCheck.code,
      reason: rpcCheck.message,
      ...(hasJsonRpcId(params.msg.id)
        ? { response: jsonRpcErrorBody(params.msg.id, rpcCheck.code, rpcCheck.message) as Record<string, unknown> }
        : {}),
    };
  }

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

  if (!lifecycle.allowed) {
    // Enforce regardless of `id`; only the response body requires one.
    const lifecycleReason = lifecycle.reason ?? 'MCP lifecycle guard blocked request';
    return {
      blocked: true,
      code: -32001,
      reason: lifecycleReason,
      ...(hasJsonRpcId(params.msg.id)
        ? { response: jsonRpcErrorBody(params.msg.id, -32001, lifecycleReason) as Record<string, unknown> }
        : {}),
    };
  }

  const authorization = authorizeRequestTarget(method, params.msg);
  if (authorization && !authorization.allowed) {
    // Block regardless of whether the request carries an id. `id` is optional in
    // the JSON-RPC schema, and a client omitting it was previously forwarded to
    // the upstream server with a traversal URI intact — the one shape the guard
    // exists to stop. An id-less request gets no response, per JSON-RPC.
    if (!hasJsonRpcId(params.msg.id)) {
      Logger.error(
        `[mcp-pre-pipeline:${params.serverName}] Blocked id-less ${method} ` +
          `(${authorization.reason}); no response is sent for a request without an id`,
      );
      return { blocked: true, code: authorization.code, reason: authorization.reason };
    }
    return {
      blocked: true,
      code: authorization.code,
      reason: authorization.reason,
      response: jsonRpcErrorBody(
        params.msg.id,
        authorization.code,
        authorization.reason,
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
  return jsonRpcErrorBody(id, -32002, reason ?? 'Resource/prompt blocked by Mastyf AI') as Record<
    string,
    unknown
  >;
}
