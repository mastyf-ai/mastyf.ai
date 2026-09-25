import type { IncomingHttpHeaders, IncomingMessage } from 'http';
export declare function getHttpMaxBodyBytes(): number;
export declare function getHttpMaxJsonDepth(): number;
export declare function containsCrlf(value: string): boolean;
/** Reject header names/values with CRLF injection. */
export declare function validateRequestHeaders(headers: IncomingHttpHeaders): string | null;
/** Reject path traversal in request URL path. */
export declare function validateRequestUrlPath(url: string | undefined): string | null;
/** Host must be a sane hostname (no CRLF, spaces, or scheme). */
export declare function validateHostHeader(host: string | string[] | undefined): string | null;
export declare function isXmlContentType(contentType: string | undefined): boolean;
export declare function looksLikeXmlBody(body: string): boolean;
/** Iterative depth check — avoids stack overflow on deeply nested JSON. */
export declare function jsonDepth(value: unknown, _depth?: number, maxDepth?: number): boolean;
/** Reject upstream response headers containing CRLF (response-splitting). */
export declare function validateResponseHeaders(headers: Record<string, string | string[] | undefined>): {
    ok: true;
} | {
    ok: false;
    error: string;
};
export declare function parseJsonWithDepthLimit(text: string, maxDepth?: number): {
    ok: true;
    value: unknown;
} | {
    ok: false;
    error: string;
};
/** Validate MCP JSON-RPC message for protocol-level attacks. Returns error message or null. */
export declare function validateMcpMessage(msg: unknown): string | null;
/** Check if a parsed body is a batch JSON-RPC array (MCP does not support batching). */
export declare function isRpcBatch(body: unknown): boolean;
/** Strip CRLF from upstream response headers before forwarding. */
export declare function sanitizeResponseHeaders(headers: IncomingHttpHeaders): Record<string, string | string[] | undefined>;
/** Proxy must not reflect arbitrary Origin into ACAO. */
export declare function applySafeCorsHeaders(reqHeaders: IncomingHttpHeaders, resHeaders: Record<string, string | string[] | undefined>): void;
export type ReadBodyResult = {
    ok: true;
    body: string;
} | {
    ok: false;
    tooLarge: true;
    bytes: number;
    limit: number;
};
/** Read HTTP body with a hard byte cap (SSE, streamable HTTP, etc.). */
export declare function readRequestBodyWithLimit(req: IncomingMessage, maxBytes?: number): Promise<ReadBodyResult>;
//# sourceMappingURL=http-proxy-security.d.ts.map