export declare function isPolicyTimingEnvelopeEnabled(): boolean;
export declare function policyMinEvalMs(): number;
export declare function proxyTimingNormalizeMs(): number;
/** Synchronous minimum duration (used by harness sync evaluate). */
export declare function waitPolicyTimingEnvelopeSync(startedAt: number): void;
/** Async minimum duration (production proxy evaluateAsync). */
export declare function waitPolicyTimingEnvelopeAsync(startedAt: number): Promise<void>;
/** Optional extra delay on tools/call to reduce request-path timing oracle. */
export declare function waitProxyTimingNormalize(startedAt: number): Promise<void>;
//# sourceMappingURL=policy-timing-envelope.d.ts.map