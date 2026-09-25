/**
 * Shared pre-forward guards for tools/call across all proxy transports.
 */
import { agenticPreForwardToolCall, buildAgenticToolCallContext, } from './agentic-hooks-bridge.js';
import { checkExpandedPayload } from './payload-guard.js';
import { hasJsonRpcId, jsonRpcErrorBody } from './json-rpc-utils.js';
export async function runToolCallPreForwardGuard(serverName, toolName, args, requestId, opts) {
    if (args !== undefined) {
        const expanded = checkExpandedPayload(args);
        if (!expanded.ok) {
            return {
                blocked: true,
                code: -32001,
                message: `Blocked by Mastyf AI: ${expanded.reason}`,
            };
        }
    }
    if (args) {
        const ctx = buildAgenticToolCallContext({
            requestId,
            agentId: opts?.agentId,
            mcpSessionId: opts?.mcpSessionId,
            meta: opts?.meta ?? args._meta,
            headers: opts?.headers,
        });
        const agentic = await agenticPreForwardToolCall(serverName, toolName, args, ctx);
        if (agentic.blocked) {
            return {
                blocked: true,
                code: -32001,
                message: `Blocked by Mastyf AI: ${agentic.reason || 'agentic policy'}`,
            };
        }
        return { blocked: false, arguments: agentic.sanitizedArgs ?? args };
    }
    return { blocked: false };
}
/** JSON-RPC error object for transports that return Record responses. */
export function toolCallGuardBlockResponse(id, guard) {
    if (!hasJsonRpcId(id)) {
        return { jsonrpc: '2.0', error: { code: guard.code, message: guard.message } };
    }
    return jsonRpcErrorBody(id, guard.code, guard.message);
}
//# sourceMappingURL=tool-call-pre-guard.js.map