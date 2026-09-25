import { getAllActiveServerNames, parseSecurityScanDetails } from '../utils/db-aggregate.js';
import { PricingClient } from '../clients/pricing-client.js';
import { Logger } from '../utils/logger.js';
let registeredCollector = null;
/** Register the live collector (proxy / AI engine) for policy decision ingestion. */
export function registerDataCollector(collector) {
    registeredCollector = collector;
}
export function recordPolicyDecisionGlobal(d) {
    registeredCollector?.recordPolicyDecision(d);
}
export class DataCollector {
    db;
    securityScanner;
    costAuditor;
    healthMonitor;
    pricingClient;
    policyDecisions = [];
    maxDecisionsStored = 10000;
    constructor(db, securityScanner, costAuditor, healthMonitor, pricingClient) {
        this.db = db;
        this.securityScanner = securityScanner;
        this.costAuditor = costAuditor;
        this.healthMonitor = healthMonitor;
        this.pricingClient = pricingClient || new PricingClient();
    }
    async collectCallRecords(serverName) {
        try {
            if (serverName)
                return await this.db.getCallRecordsForServer(serverName);
            const servers = await getAllActiveServerNames(this.db);
            if (servers.length === 0)
                return [];
            const all = [];
            for (const srv of servers) {
                all.push(...await this.db.getCallRecordsForServer(srv));
            }
            return all;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.warn(`[DataCollector] callRecords failed: ${message}`);
            return [];
        }
    }
    recordPolicyDecision(d) {
        this.policyDecisions.push(d);
        if (this.policyDecisions.length > this.maxDecisionsStored) {
            this.policyDecisions = this.policyDecisions.slice(-this.maxDecisionsStored);
        }
    }
    getPolicyDecisions() {
        return [...this.policyDecisions];
    }
    async collectSecurityReports(servers) {
        if (this.securityScanner) {
            try {
                return await Promise.all(servers.map(s => this.securityScanner.scanServer(s)));
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                Logger.warn(`[DataCollector] securityReports failed: ${message}`);
                return [];
            }
        }
        return this.collectSecurityReportsFromDb(servers);
    }
    async collectSecurityReportsFromDb(servers) {
        const reports = [];
        for (const s of servers) {
            const scan = await this.db.getLatestSecurityScan(s.name);
            if (!scan)
                continue;
            const parsed = parseSecurityScanDetails(scan);
            if (parsed)
                reports.push(parsed);
        }
        return reports;
    }
    async collectCostReports(servers) {
        if (!this.costAuditor)
            return [];
        try {
            return await Promise.all(servers.map(s => this.costAuditor.auditServer(s)));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.warn(`[DataCollector] costReports failed: ${message}`);
            return [];
        }
    }
    async collectHealthReports(servers) {
        if (this.healthMonitor) {
            try {
                return await Promise.all(servers.map(s => this.healthMonitor.checkServer(s)));
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                Logger.warn(`[DataCollector] healthReports failed: ${message}`);
                return [];
            }
        }
        return this.collectHealthReportsFromDb(servers);
    }
    async collectHealthReportsFromDb(servers) {
        const reports = [];
        for (const s of servers) {
            const hc = await this.db.getLatestHealthCheck(s.name);
            if (!hc)
                continue;
            const toolCount = hc.tool_count ?? 0;
            reports.push({
                serverName: s.name,
                latencyMs: hc.latency_ms,
                successRate: hc.success ? 1 : 0,
                contextPressure: Math.min(toolCount / 20, 1),
                toolCount,
                overloadWarning: toolCount > 15,
                recommendations: toolCount > 15 ? ['Tool overload detected'] : [],
            });
        }
        return reports;
    }
    async collectAll(servers) {
        const [callRecords, securityReports, costReports, healthReports] = await Promise.all([
            this.collectCallRecords(),
            this.collectSecurityReports(servers),
            this.collectCostReports(servers),
            this.collectHealthReports(servers),
        ]);
        const decisions = this.getPolicyDecisions();
        const activeServers = [...new Set(servers.map(s => s.name))];
        const totalCalls = callRecords.length;
        const totalTokens = callRecords.reduce((s, r) => s + r.totalTokens, 0);
        const estimatedTotalCost = costReports.reduce((s, r) => s + (r.actualCostUSD ?? r.estimatedCostUSD), 0);
        const totalLatency = callRecords.reduce((s, r) => s + r.durationMs, 0);
        const avgLatency = totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0;
        const blockedFromRecords = callRecords.filter((r) => r.blocked).length;
        const blockedFromDecisions = decisions.filter((d) => d.action === 'block').length;
        const blocked = Math.max(blockedFromRecords, blockedFromDecisions);
        const flagged = decisions.filter((d) => d.action === 'flag').length;
        const serverIndex = {};
        for (const s of servers)
            serverIndex[s.name] = s;
        return {
            timestamp: new Date().toISOString(),
            callRecords,
            securityReports,
            costReports,
            healthReports,
            servers: serverIndex,
            metadata: {
                totalCalls, totalTokens, estimatedTotalCost, activeServers,
                pricingModel: this.costAuditor ? await this.costAuditor.getPricingModel() : 'unknown',
                averageLatencyMs: avgLatency,
                blockedCalls: blocked,
                flaggedCalls: flagged,
            },
        };
    }
}
//# sourceMappingURL=data-collector.js.map