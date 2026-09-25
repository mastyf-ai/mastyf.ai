/**
 * JSON-RPC 2.0 helpers for proxy error responses.
 */
/**
 * Named constants for MCP Mastyf AI JSON-RPC error codes.
 * Prevents magic number proliferation across transport implementations.
 */
export const JSON_RPC_ERROR_CODES = {
    /** Policy engine blocked the tool call */
    POLICY_BLOCK: -32001,
    /** Response inspection blocked the response */
    RESPONSE_BLOCK: -32002,
    /** Authentication failure (missing or invalid credentials) */
    AUTH_FAILURE: -32003,
    /** DPoP proof validation failure */
    DPOP_FAILURE: -32004,
    /** Server overloaded / circuit breaker open */
    OVERLOADED: -32005,
    /** Upstream request timeout */
    TIMEOUT: -32006,
    /** Malformed JSON / parse error (standard JSON-RPC) */
    PARSE_ERROR: -32700,
};
/** True when the request expects a JSON-RPC response (id may be 0). */
export function hasJsonRpcId(id) {
    return id !== undefined && id !== null;
}
export function jsonRpcErrorBody(id, code, message, data) {
    const body = {
        jsonrpc: '2.0',
        error: { code, message, ...(data ? { data } : {}) },
    };
    if (hasJsonRpcId(id)) {
        body.id = id;
    }
    return body;
}
//# sourceMappingURL=json-rpc-utils.js.map