import { getMaxPayloadBytes } from './payload-guard.js';
const DEFAULT_MAX_JSON_DEPTH = 32;
export function getHttpMaxBodyBytes() {
    const raw = process.env['MASTYF_AI_HTTP_MAX_BODY_BYTES'];
    if (raw === undefined || raw === '')
        return 10 * 1024 * 1024;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 10 * 1024 * 1024;
}
export function getHttpMaxJsonDepth() {
    const raw = process.env['MASTYF_AI_HTTP_MAX_JSON_DEPTH'];
    if (raw === undefined || raw === '')
        return DEFAULT_MAX_JSON_DEPTH;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_JSON_DEPTH;
}
export function containsCrlf(value) {
    return /[\r\n]/.test(value);
}
/** Reject header names/values with CRLF injection. */
export function validateRequestHeaders(headers) {
    for (const [key, val] of Object.entries(headers)) {
        if (containsCrlf(key))
            return 'Invalid header name';
        if (val === undefined)
            continue;
        const values = Array.isArray(val) ? val : [val];
        for (const v of values) {
            if (containsCrlf(String(v)))
                return 'Invalid header value';
        }
    }
    return null;
}
/** Reject path traversal in request URL path. */
export function validateRequestUrlPath(url) {
    if (!url)
        return null;
    const path = url.split('?')[0] || '/';
    const lower = path.toLowerCase();
    if (path.includes('..') ||
        lower.includes('%2e%2e') ||
        lower.includes('%252e') ||
        lower.includes('\\')) {
        return 'Path traversal not allowed';
    }
    return null;
}
/** Host must be a sane hostname (no CRLF, spaces, or scheme). */
export function validateHostHeader(host) {
    if (host === undefined)
        return null;
    const value = Array.isArray(host) ? host[0] : host;
    if (!value || containsCrlf(value))
        return 'Invalid Host header';
    if (/[\s/\\]/.test(value) || value.includes('://'))
        return 'Invalid Host header';
    if (!/^[a-zA-Z0-9._:-]+$/.test(value.split(':')[0] || '')) {
        return 'Invalid Host header';
    }
    return null;
}
export function isXmlContentType(contentType) {
    if (!contentType)
        return false;
    const ct = contentType.toLowerCase();
    return ct.includes('application/xml') || ct.includes('text/xml') || ct.includes('+xml');
}
export function looksLikeXmlBody(body) {
    const trimmed = body.trimStart();
    return trimmed.startsWith('<?xml') || trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<');
}
/** Iterative depth check — avoids stack overflow on deeply nested JSON. */
export function jsonDepth(value, _depth = 0, maxDepth = getHttpMaxJsonDepth()) {
    const queue = [{ node: value, depth: 0 }];
    while (queue.length > 0) {
        const { node, depth } = queue.shift();
        if (depth > maxDepth)
            return false;
        if (node === null || typeof node !== 'object')
            continue;
        for (const child of Object.values(node)) {
            queue.push({ node: child, depth: depth + 1 });
        }
    }
    return true;
}
/** Reject upstream response headers containing CRLF (response-splitting). */
export function validateResponseHeaders(headers) {
    for (const [key, val] of Object.entries(headers)) {
        if (containsCrlf(key))
            return { ok: false, error: `CRLF in header name: ${key}` };
        if (val === undefined)
            continue;
        const values = Array.isArray(val) ? val : [val];
        for (const v of values) {
            if (containsCrlf(String(v))) {
                return { ok: false, error: `CRLF in header value: ${key}` };
            }
        }
    }
    return { ok: true };
}
export function parseJsonWithDepthLimit(text, maxDepth = getHttpMaxJsonDepth()) {
    try {
        const value = JSON.parse(text);
        if (!jsonDepth(value, 0, maxDepth)) {
            return { ok: false, error: 'JSON nesting too deep' };
        }
        return { ok: true, value };
    }
    catch {
        return { ok: false, error: 'Invalid JSON' };
    }
}
/** Validate MCP JSON-RPC message for protocol-level attacks. Returns error message or null. */
export function validateMcpMessage(msg) {
    if (!msg || typeof msg !== 'object')
        return 'Invalid MCP message';
    const m = msg;
    if (m.method !== 'tools/call')
        return null;
    if (!m.jsonrpc || m.jsonrpc !== '2.0')
        return 'Missing or invalid jsonrpc version';
    if (m.id === undefined || m.id === null)
        return 'Missing request id';
    if (typeof m.id !== 'string' && typeof m.id !== 'number')
        return 'Invalid request id type';
    if (typeof m.id === 'string' && m.id.length > 200)
        return 'Request id too long';
    if (typeof m.id === 'number' && m.id < 0)
        return 'Negative request id not allowed';
    const params = m.params;
    if (!params || typeof params !== 'object')
        return 'Missing params';
    const toolName = params.name;
    if (!toolName || typeof toolName !== 'string' || toolName.trim().length === 0)
        return 'Empty tool name';
    if (toolName.length > 500)
        return 'Tool name too long';
    const args = params.arguments;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
        const argKeys = Object.keys(args);
        if (argKeys.length > 200)
            return 'Too many arguments';
        if (argKeys.some(k => k.length > 500))
            return 'Argument key too long';
        if (argKeys.some(k => /^[\$]/.test(k)))
            return 'NoSQL operator in argument key not allowed';
    }
    if (typeof m.id === 'number' && m.id < 0)
        return 'Negative request id not allowed';
    return null;
}
/** Check if a parsed body is a batch JSON-RPC array (MCP does not support batching). */
export function isRpcBatch(body) {
    return Array.isArray(body);
}
/** Strip CRLF from upstream response headers before forwarding. */
export function sanitizeResponseHeaders(headers) {
    const out = {};
    for (const [key, val] of Object.entries(headers)) {
        if (containsCrlf(key))
            continue;
        if (val === undefined)
            continue;
        if (Array.isArray(val)) {
            const clean = val.filter((v) => !containsCrlf(String(v)));
            if (clean.length > 0)
                out[key] = clean;
        }
        else if (!containsCrlf(String(val))) {
            out[key] = val;
        }
    }
    return out;
}
/** Proxy must not reflect arbitrary Origin into ACAO. */
export function applySafeCorsHeaders(reqHeaders, resHeaders) {
    const origin = reqHeaders['origin'];
    if (!origin)
        return;
    const originStr = Array.isArray(origin) ? origin[0] : origin;
    if (!originStr || containsCrlf(originStr))
        return;
    // Never echo attacker Origin; only same-origin style hosts are allowed for ACAO.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(originStr)) {
        resHeaders['access-control-allow-origin'] = originStr;
    }
}
/** Read HTTP body with a hard byte cap (SSE, streamable HTTP, etc.). */
export async function readRequestBodyWithLimit(req, maxBytes = getMaxPayloadBytes()) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = chunk;
        total += buf.length;
        if (total > maxBytes) {
            return { ok: false, tooLarge: true, bytes: total, limit: maxBytes };
        }
        chunks.push(buf);
    }
    return { ok: true, body: Buffer.concat(chunks).toString('utf8') };
}
//# sourceMappingURL=http-proxy-security.js.map