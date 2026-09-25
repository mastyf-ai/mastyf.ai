import { getAgenticContainer, isAgenticEnabled } from '../utils/agentic-container.js';
import { recordAgenticAudit, runAgenticDeniedCallHooks, runAgenticPostCallHooks, runAgenticPreForwardHooks, } from '../agentic/proxy-integration.js';
export async function agenticPreForwardToolCall(serverName, toolName, args, ctx, legacyAgentId) {
    const container = getAgenticContainer();
    if (!isAgenticEnabled() || !container || !args) {
        return { blocked: false };
    }
    return runAgenticPreForwardHooks(container, serverName, toolName, args, ctx, legacyAgentId);
}
export function agenticRecordDeniedToolCall(params) {
    const container = getAgenticContainer();
    if (!isAgenticEnabled() || !container)
        return;
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
export async function agenticRecordCompletedToolCall(params) {
    const container = getAgenticContainer();
    if (!isAgenticEnabled() || !container)
        return;
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
        await runAgenticPostCallHooks(container, params.serverName, params.toolName, params.args, params.sessionId, params.latencyMs, true, params.agentId, params.responseSize);
    }
}
/** Build session context for fleet chain correlation across MCP servers. */
export function buildAgenticToolCallContext(params) {
    return {
        requestId: params.requestId,
        agentId: params.agentId,
        mcpSessionId: params.mcpSessionId,
        meta: params.meta,
        headers: params.headers,
    };
}
//# sourceMappingURL=agentic-hooks-bridge.js.map