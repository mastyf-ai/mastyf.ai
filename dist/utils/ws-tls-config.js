import { createHash } from 'crypto';
const PATH_RE = /(?:\/Users\/|\/home\/|\/var\/|\/etc\/|\/private\/|C:\\|\\\\)[^\s'"]+/gi;
/** Strip internal filesystem paths from client-facing proxy errors. */
export function sanitizeProxyClientError(message) {
    if (process.env.NODE_ENV !== 'production' && process.env.MASTYF_AI_SANITIZE_ERRORS !== 'true') {
        return message;
    }
    return message.replace(PATH_RE, '[path]').slice(0, 500);
}
/**
 * Optional TLS pinning for upstream WebSocket (wss://).
 * MASTYF_AI_WS_TLS_PIN_SHA256 — colon-separated SHA-256 fingerprint of server cert.
 */
export function getWebSocketTlsOptions(hostname) {
    const pin = process.env.MASTYF_AI_WS_TLS_PIN_SHA256?.trim().toLowerCase();
    const rejectUnauthorized = process.env.MCP_TLS_REJECT_UNAUTHORIZED !== 'false';
    if (!pin) {
        return { rejectUnauthorized };
    }
    const expected = pin.replace(/:/g, '');
    return {
        rejectUnauthorized: true,
        checkServerIdentity: (host, cert) => {
            const fp = createHash('sha256').update(cert.raw).digest('hex');
            if (fp !== expected) {
                return new Error(`WebSocket TLS pin mismatch for ${host ?? hostname}`);
            }
            return undefined;
        },
    };
}
/** Options object for `new WebSocket(url, protocols, options)`. */
export function webSocketClientOptions(url) {
    const tlsOpts = getWebSocketTlsOptions(new URL(url).hostname);
    return {
        rejectUnauthorized: tlsOpts.rejectUnauthorized,
        ...(tlsOpts.checkServerIdentity ? { checkServerIdentity: tlsOpts.checkServerIdentity } : {}),
    };
}
//# sourceMappingURL=ws-tls-config.js.map