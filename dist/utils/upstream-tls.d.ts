export type UpstreamTlsCheckResult = {
    ok: true;
} | {
    ok: false;
    message: string;
};
export declare function isPlaintextUpstreamAllowed(): boolean;
/** Reject http:// upstream unless dev-only plaintext flag is set (never in strict mode). */
export declare function assertUpstreamTlsAllowed(targetUrl: string): UpstreamTlsCheckResult;
/** Mandatory choke point — all proxy transports must call this before connecting upstream. */
export declare function requireUpstreamTlsAllowed(targetUrl: string): void;
//# sourceMappingURL=upstream-tls.d.ts.map