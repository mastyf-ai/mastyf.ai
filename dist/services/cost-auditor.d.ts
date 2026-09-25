import { CostReport, McpServerConfig } from '../types.js';
import { IDatabase } from '../database/database-interface.js';
/** Per-tenant caps from MASTYF_AI_TENANT_DAILY_BUDGET_JSON={"acme":100,"beta":50}. */
export declare function getTenantDailyBudgetMap(): Map<string, number>;
/** Daily spend cap from MASTYF_AI_DAILY_BUDGET_USD (preferred) or MASTYF_AI_COST_BUDGET. */
export declare function getDailyBudgetCapUsd(tenantId?: string): number;
export declare class CostAuditor {
    private tokenCounter;
    private db;
    private tenantId?;
    constructor(_pricingClient?: unknown, db?: IDatabase, _pricingModel?: string, tenantId?: string);
    /** Sum costUsd for all servers since UTC midnight. */
    getDailySpendUsd(tenantId?: string): Promise<number>;
    isDailyBudgetExceeded(tenantId?: string): Promise<{
        exceeded: boolean;
        spentUsd: number;
        capUsd: number;
    }>;
    getPricingModel(): Promise<string>;
    auditServer(server: McpServerConfig, tenantId?: string): Promise<CostReport>;
    /**
     * No proxy call_records: resolve real model, optionally probe connectivity,
     * report list rates only (zero measured cost) unless MASTYF_AI_COST_ALLOW_ESTIMATES=true.
     */
    private auditWithoutProxyRecords;
    private modelOnlyReport;
    private estimatedReportFromTools;
    private emptyReport;
    private buildReportFromRecords;
    countTokens(text: string): number;
    dispose(): void;
}
//# sourceMappingURL=cost-auditor.d.ts.map