/**
 * JSON-RPC 2.0 helpers for proxy error responses.
 */
/**
 * Named constants for MCP Mastyf AI JSON-RPC error codes.
 * Prevents magic number proliferation across transport implementations.
 */
export declare const JSON_RPC_ERROR_CODES: {
    /** Policy engine blocked the tool call */
    readonly POLICY_BLOCK: -32001;
    /** Response inspection blocked the response */
    readonly RESPONSE_BLOCK: -32002;
    /** Authentication failure (missing or invalid credentials) */
    readonly AUTH_FAILURE: -32003;
    /** DPoP proof validation failure */
    readonly DPOP_FAILURE: -32004;
    /** Server overloaded / circuit breaker open */
    readonly OVERLOADED: -32005;
    /** Upstream request timeout */
    readonly TIMEOUT: -32006;
    /** Malformed JSON / parse error (standard JSON-RPC) */
    readonly PARSE_ERROR: -32700;
};
export type JsonRpcErrorCode = (typeof JSON_RPC_ERROR_CODES)[keyof typeof JSON_RPC_ERROR_CODES];
/** True when the request expects a JSON-RPC response (id may be 0). */
export declare function hasJsonRpcId(id: unknown): id is string | number;
export declare function jsonRpcErrorBody(id: string | number | undefined | null, code: number, message: string, data?: Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=json-rpc-utils.d.ts.map