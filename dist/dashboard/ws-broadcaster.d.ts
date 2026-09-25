import { WebSocket } from 'ws';
import type { Server } from 'http';
import type { AuditTrailSync } from '../aggregator/audit-trail-sync.js';
import type { TelemetryCollector } from '../aggregator/telemetry-collector.js';
import type { LogShipper } from '../aggregator/log-shipper.js';
import type { DashboardAuth } from '../auth/dashboard-auth.js';
import type { DashboardRole } from '../auth/dashboard-rbac.js';
export type WsAuthContext = {
    authenticated: boolean;
    tenantId: string;
    roles: DashboardRole[];
};
export type WsBroadcasterOptions = {
    dashboardAuth?: DashboardAuth;
    /** Ignored unless MASTYF_AI_REQUIRE_LICENSE=true (license paywall removed by default). */
    requireLicense?: boolean;
};
/**
 * WebSocket push broadcaster — replaces polling with real-time push
 * for dashboard updates. Channels: policy, AI, audit, metrics, logs.
 * Clients subscribe with tenantId; pushes are scoped per connection.
 */
export declare class WsBroadcaster {
    private wss;
    private clients;
    private clientSubscriptions;
    private clientTenants;
    private clientRoles;
    private options;
    private auditSync?;
    private telemetryCollector?;
    private logShipper?;
    private pushInterval?;
    /** Live data providers (tenant-scoped where noted) */
    private dataProviders;
    constructor(server: Server, options?: WsBroadcasterOptions);
    private isChannelAllowed;
    setDataProviders(providers: typeof this.dataProviders): void;
    setAggregators(auditSync?: AuditTrailSync, telemetryCollector?: TelemetryCollector, logShipper?: LogShipper): void;
    private matchesTenant;
    /**
     * Broadcast to clients subscribed to the channel and matching tenantId (when set).
     */
    broadcast(event: DashboardEvent, eventTenantId?: string): void;
    startDataPushLoop(intervalMs?: number): ReturnType<typeof setInterval>;
    stopDataPushLoop(): void;
    private pushLiveDataForClient;
    private pushLiveData;
    private sendSnapshot;
    eventToChannel(type: DashboardEventType): string;
    getClientCount(): number;
    /** Test helper: tenant bound to a client socket */
    getClientTenant(ws: WebSocket): string | undefined;
}
export type DashboardEventType = 'policy-block' | 'health-change' | 'cost-threshold' | 'circuit-breaker-open' | 'policy-reload' | 'ai:suggestions' | 'ai:baselines' | 'ai:report' | 'ai:state' | 'ai:threats' | 'audit:events' | 'audit:decision' | 'metrics:live' | 'metrics:history' | 'logs:recent' | 'logs:alert' | 'instances:list' | 'instances:status' | 'flow:step' | 'swarm:progress' | 'swarm:done' | 'swarm:failed' | 'semantic:queued' | 'semantic:complete' | 'analysis:artifact' | 'threat-discovery:started' | 'threat-discovery:done' | 'threat-discovery:failed' | 'tribunal:started' | 'tribunal:done' | 'tribunal:failed' | 'snapshot';
export interface DashboardEvent {
    type: DashboardEventType;
    serverName?: string;
    tenantId?: string;
    payload: Record<string, unknown>;
    timestamp: number;
}
//# sourceMappingURL=ws-broadcaster.d.ts.map