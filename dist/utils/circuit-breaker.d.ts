export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private successCount;
    /** True while a HALF_OPEN probe is in flight — only one probe allowed. */
    private probing;
    /** Timestamp when the circuit first transitioned to OPEN (used for recovery timer) */
    private openedAt;
    private openCycles;
    private currentProbeTimeout;
    private readonly resetTimeout;
    private readonly failureThreshold;
    private readonly successThreshold;
    private readonly name;
    constructor(name: string, options?: {
        failureThreshold?: number;
        successThreshold?: number;
        resetTimeoutMs?: number;
    });
    private maxProbeInterval;
    private nextProbeTimeout;
    /** Check if the circuit allows a request through */
    allowRequest(): boolean;
    /** Record a successful request */
    recordSuccess(): void;
    /** Record a failed request */
    recordFailure(): void;
    getState(): CircuitState;
    getStats(): {
        state: CircuitState;
        failureCount: number;
        successCount: number;
    };
    /** Force circuit open (incident isolation). */
    forceOpen(reason?: string): void;
    private notifyCircuitOpen;
    private syncRedis;
    /** Hydrate from Redis snapshot (multi-replica). */
    applyRedisSnapshot(snap: {
        state: CircuitState;
        failureCount: number;
        openedAt: number;
    }): void;
}
//# sourceMappingURL=circuit-breaker.d.ts.map