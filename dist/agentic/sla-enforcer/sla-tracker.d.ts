export interface SlaConfig {
    maxLatencyP95: number;
    maxErrorRate: number;
    windowMinutes: number;
}
export interface SlaStatus {
    serverName: string;
    toolName: string;
    latencyP50: number;
    latencyP95: number;
    errorRate: number;
    breaches: SlaBreach[];
    circuitState: 'closed' | 'half-open' | 'open';
}
export interface SlaBreach {
    timestamp: string;
    metric: string;
    value: number;
    threshold: number;
}
export declare class SlaEnforcer {
    private metrics;
    private circuitState;
    private config;
    record(serverName: string, toolName: string, latencyMs: number, success: boolean): void;
    check(serverName: string, toolName: string): SlaStatus;
    getStats(): {
        totalTools: number;
        openCircuits: number;
    };
}
//# sourceMappingURL=sla-tracker.d.ts.map