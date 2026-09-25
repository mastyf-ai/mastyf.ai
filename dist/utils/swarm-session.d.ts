/** Set when dashboard-server (or tests) initialize the session clock. */
export declare let dashboardSessionStartedMs: number;
export declare function resetDashboardSessionForTests(at?: number): void;
/** Default true — set MASTYF_AI_DASHBOARD_STRICT_LIVE=false to disable session gating. */
export declare function isStrictLiveDashboard(): boolean;
export declare function isLegacyArtifactsAllowed(): boolean;
/** Earliest job start time in this dashboard session, if any. */
export declare function getSessionJobStartedMs(tenantId: string): number | null;
export declare function hasRunningSessionJob(tenantId: string): boolean;
/** True when a swarm / threat-discovery job ran (or is running) this dashboard session. */
export declare function isSwarmSessionActiveForTenant(tenantId: string): boolean;
export declare function isLegacySwarmPath(filePath: string): boolean;
/**
 * Whether a swarm artifact file may be exposed on the dashboard.
 * Legacy committed dir requires opt-in env AND an active session job.
 */
export declare function isSwarmArtifactVisibleForSession(filePath: string, tenantId?: string): boolean;
export type SwarmDataProvenance = {
    strictLive: boolean;
    sessionActive: boolean;
    legacyAllowed: boolean;
    source: 'session-swarm' | 'legacy-swarm' | 'none';
};
export declare function swarmDataProvenance(tenantId: string): SwarmDataProvenance;
//# sourceMappingURL=swarm-session.d.ts.map