import { resolveTenantId } from '../tenant/resolve-tenant.js';
import { Logger } from './logger.js';
export function runPreflightScanAndHealth(servers, db) {
    if (process.env.MASTYF_AI_SKIP_PREFLIGHT_SCAN === 'true')
        return;
    void (async () => {
        try {
            const { SecurityScanner } = await import('../services/security-scanner.js');
            const { HealthMonitor } = await import('../services/health-monitor.js');
            const scanner = new SecurityScanner();
            const tenantId = resolveTenantId();
            const healthMonitor = new HealthMonitor(db, tenantId);
            for (const server of servers) {
                try {
                    const report = await scanner.scanServer(server);
                    await db.addSecurityScan(server.name, report.score, report.cves.length, report, tenantId);
                    const health = await healthMonitor.checkServer(server, tenantId);
                    await db.addHealthCheck(server.name, health.latencyMs, health.successRate > 0.5, health.toolCount, tenantId);
                    const crit = report.cves.filter((c) => c.severity === 'CRITICAL').length;
                    const high = report.cves.filter((c) => c.severity === 'HIGH').length;
                    Logger.info(`[preflight] ${server.name}: security score=${report.score} cves=${report.cves.length} (CRIT=${crit} HIGH=${high}) health=${health.latencyMs}ms tools=${health.toolCount}`);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    Logger.warn(`[preflight] ${server.name}: scan/health skipped (${msg})`);
                }
            }
        }
        catch (err) {
            Logger.warn(`[preflight] failed to start: ${err instanceof Error ? err.message : String(err)}`);
        }
    })();
}
//# sourceMappingURL=preflight-scan.js.map