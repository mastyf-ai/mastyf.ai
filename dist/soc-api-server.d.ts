/**
 * MCP Mastyf AI — SOC Dashboard Backend API Server
 *
 * Serves real data from MCP Mastyf AI services:
 *   - SecurityScanner  → /api/security
 *   - HealthMonitor    → /api/health
 *   - CostAuditor      → /api/cost, /api/cost/breakdown, /api/cost/timeseries
 *   - IDatabase        → /api/aggregate/audit, /api/aggregate/metrics
 *   - PolicyEngine     → /api/policy
 *   - Config discovery → /api/instances
 *
 * Run: node --loader ts-node/esm src/soc-api-server.ts
 * Or:  npx tsx src/soc-api-server.ts
 */
export interface SocApiServerHandle {
    port: number;
    close: () => Promise<void>;
}
export declare function startSocApiServer(port?: number): Promise<SocApiServerHandle>;
//# sourceMappingURL=soc-api-server.d.ts.map