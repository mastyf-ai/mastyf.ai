interface ControlPlaneConfig {
    url: string;
    apiKey: string;
    instanceId: string;
    instanceName?: string;
    instanceVersion?: string;
    region?: string;
    pollIntervalMs?: number;
    auditPushIntervalMs?: number;
    onPolicyUpdate?: (yaml: string, version: number) => void;
    onAuditSnapshot?: () => Promise<FleetSnapshot>;
    onLicenseUpdate?: (tier: string, features: string[], maxInstances: number) => void;
}
interface FleetSnapshot {
    totalRequests: number;
    blockedRequests: number;
    allowedRequests: number;
    flaggedRequests: number;
    topBlockedTools: Array<{
        tool: string;
        count: number;
    }>;
    topBlockedRules: Array<{
        rule: string;
        count: number;
    }>;
    avgLatencyMs: number;
}
export declare class ControlPlaneClient {
    private config;
    private pollTimer;
    private auditTimer;
    private registered;
    constructor(config: ControlPlaneConfig);
    start(): Promise<void>;
    private fetchLicense;
    stop(): void;
    private call;
    private sendHeartbeat;
    private startPolicyPolling;
    private startAuditPushing;
    private buildAuditSnapshot;
    shutdown(): Promise<void>;
}
export declare function getControlPlaneClient(): ControlPlaneClient | null;
export declare function createControlPlaneClient(opts?: {
    onPolicyUpdate?: (yaml: string, version: number) => void;
    onAuditSnapshot?: () => Promise<FleetSnapshot>;
    onLicenseUpdate?: (tier: string, features: string[], maxInstances: number) => void;
}): ControlPlaneClient | null;
export {};
//# sourceMappingURL=control-plane-client.d.ts.map