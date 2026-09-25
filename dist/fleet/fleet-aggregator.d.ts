export interface FleetInstanceRow {
    instanceId: string;
    instanceName: string;
    hostname: string;
    status: string;
    region?: string;
    lastHeartbeat: string;
    totalRequests: number;
    blockedRequests: number;
    totalCostUsd: number;
    dbPath?: string;
}
export interface FleetStatusReport {
    region: string;
    source: 'postgres' | 'sqlite' | 'multi-sqlite';
    totalInstances: number;
    activeInstances: number;
    totalRequests: number;
    totalBlocked: number;
    totalCostUsd: number;
    instances: FleetInstanceRow[];
}
export declare function getFleetStatus(): Promise<FleetStatusReport>;
//# sourceMappingURL=fleet-aggregator.d.ts.map