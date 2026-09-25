import tls from 'tls';
/** Strip internal filesystem paths from client-facing proxy errors. */
export declare function sanitizeProxyClientError(message: string): string;
export interface WsTlsOptions {
    rejectUnauthorized: boolean;
    checkServerIdentity?: typeof tls.checkServerIdentity;
}
/**
 * Optional TLS pinning for upstream WebSocket (wss://).
 * MASTYF_AI_WS_TLS_PIN_SHA256 — colon-separated SHA-256 fingerprint of server cert.
 */
export declare function getWebSocketTlsOptions(hostname: string): WsTlsOptions;
/** Options object for `new WebSocket(url, protocols, options)`. */
export declare function webSocketClientOptions(url: string): Record<string, unknown>;
//# sourceMappingURL=ws-tls-config.d.ts.map