/**
 * Unified MCP lifecycle + resource/prompt gating for all proxy transports.
 */
import { hasJsonRpcId, jsonRpcErrorBody } from './json-rpc-utils.js';
import { validateMcpJsonRpcMessage } from '../validation/mcp-jsonrpc.js';
import { gateMcpMethodResponse, recordMcpLifecycleRequest, runMcpLifecyclePreCheck, } from './mcp-lifecycle-bridge.js';
const RESPONSE_METHODS = new Set(['resources/read', 'prompts/get']);
export function runMcpPrePipeline(params) {
    const rpcCheck = validateMcpJsonRpcMessage(params.msg);
    if (!rpcCheck.ok && hasJsonRpcId(params.msg.id)) {
        return {
            blocked: true,
            response: jsonRpcErrorBody(params.msg.id, rpcCheck.code, rpcCheck.message),
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
    if (!lifecycle.allowed && hasJsonRpcId(params.msg.id)) {
        return {
            blocked: true,
            response: jsonRpcErrorBody(params.msg.id, -32001, lifecycle.reason ?? 'MCP lifecycle guard blocked request'),
        };
    }
    return {
        blocked: false,
        session: { sessionId: lifecycle.sessionId, agentId: lifecycle.agentId },
        trackResponse: RESPONSE_METHODS.has(method) && hasJsonRpcId(params.msg.id),
        requestMethod: RESPONSE_METHODS.has(method) ? method : undefined,
    };
}
export function applyMcpResponsePipeline(params) {
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
export function mcpResponseBlockJson(id, reason) {
    return jsonRpcErrorBody(id, -32002, reason ?? 'Resource/prompt blocked by Mastyf AI');
}
//# sourceMappingURL=mcp-request-pipeline.js.map