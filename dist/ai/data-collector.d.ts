import { HistoryDatabase } from '../database/history-db.js';
import { ProxyCallRecord, CostReport, SecurityReport, HealthReport, McpServerConfig } from '../types.js';
import { SecurityScanner } from '../services/security-scanner.js';
import { CostAuditor } from '../services/cost-auditor.js';
import { HealthMonitor } from '../services/health-monitor.js';
import { PricingClient } from '../clients/pricing-client.js';
export interface ServerIndex {
    [serverName: string]: McpServerConfig;
}
export interface GovernanceSnapshot {
    timestamp: string;
    callRecords: ProxyCallRecord[];
    securityReports: SecurityReport[];
    costReports: CostReport[];
    healthReports: HealthReport[];
    servers: ServerIndex;
    metadata: {
        totalCalls: number;
        totalTokens: number;
        estimatedTotalCost: number;
        activeServers: string[];
        pricingModel: string;
        averageLatencyMs: number;
        blockedCalls: number;
        flaggedCalls: number;
    };
}
export interface PolicyDecisionRecord {
    requestId: string | number;
    serverName: string;
    toolName: string;
    action: 'pass' | 'block' | 'flag';
    rule: string;
    reason: string;
    timestamp: string;
    requestTokens: number;
}
/** Register the live collector (proxy / AI engine) for policy decision ingestion. */
export declare function registerDataCollector(collector: DataCollector): void;
export declare function recordPolicyDecisionGlobal(d: PolicyDecisionRecord): void;
export declare class DataCollector {
    private db;
    private securityScanner?;
    private costAuditor?;
    private healthMonitor?;
    private pricingClient;
    private policyDecisions;
    private maxDecisionsStored;
    constructor(db: HistoryDatabase, securityScanner?: SecurityScanner, costAuditor?: CostAuditor, healthMonitor?: HealthMonitor, pricingClient?: PricingClient);
    collectCallRecords(serverName?: string): Promise<ProxyCallRecord[]>;
    recordPolicyDecision(d: PolicyDecisionRecord): void;
    getPolicyDecisions(): PolicyDecisionRecord[];
    collectSecurityReports(servers: McpServerConfig[]): Promise<SecurityReport[]>;
    private collectSecurityReportsFromDb;
    collectCostReports(servers: McpServerConfig[]): Promise<CostReport[]>;
    collectHealthReports(servers: McpServerConfig[]): Promise<HealthReport[]>;
    private collectHealthReportsFromDb;
    collectAll(servers: McpServerConfig[]): Promise<GovernanceSnapshot>;
}
//# sourceMappingURL=data-collector.d.ts.map