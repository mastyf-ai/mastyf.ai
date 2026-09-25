import type { ThreatSignature } from '../utils/fleet-threat-signatures.js';
export type HeartbeatMetrics = {
    totalRequests?: number;
    blockedRequests?: number;
    totalCostUsd?: number;
    topBlockRules?: Array<{
        rule: string;
        count: number;
    }>;
    threatSignatures?: ThreatSignature[];
    federatedStats?: Record<string, unknown>;
};
export declare function isInstanceRegistryEnabled(): boolean;
export declare function sendInstanceHeartbeat(metrics?: HeartbeatMetrics): Promise<boolean>;
export declare function startInstanceRegistry(metricsProvider?: () => Promise<HeartbeatMetrics>): void;
export declare function stopInstanceRegistry(): void;
//# sourceMappingURL=instance-registry.d.ts.map