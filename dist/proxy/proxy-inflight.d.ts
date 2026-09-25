/**
 * Shared max in-flight limit for tools/call across proxy transports.
 */
export declare function proxyMaxInflight(): number;
export declare function isProxyInflightExceeded(currentInFlight: number): boolean;
/** Acquire in-flight slot for stateless HTTP/SSE transports. */
export declare function acquireProxyInflight(serverName: string): {
    ok: boolean;
    current: number;
    max: number;
};
export declare function releaseProxyInflight(serverName: string): void;
export declare function getTotalProxyInflight(): number;
/** @internal */
export declare function resetProxyInflightForTests(): void;
//# sourceMappingURL=proxy-inflight.d.ts.map