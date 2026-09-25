import type { IDatabase } from '../database/database-interface.js';
export type DashboardFleetInstance = {
    instanceId: string;
    instanceName: string;
    hostname: string;
    status: string;
    region?: string;
    lastHeartbeat: string;
    totalRequests: number;
    blockedRequests: number;
    totalCostUsd: number;
    avgLatencyMs?: number;
    fleetSource: string;
    dbPath?: string;
};
export type DashboardFleetResponse = {
    available: boolean;
    source: string;
    region: string;
    totalInstances: number;
    activeInstances: number;
    totalRequests: number;
    totalBlocked: number;
    totalCostUsd: number;
    instances: DashboardFleetInstance[];
};
export declare function buildDashboardFleetResponse(db: IDatabase | null, tenantId: string | undefined): Promise<DashboardFleetResponse>;
//# sourceMappingURL=dashboard-fleet-api.d.ts.map