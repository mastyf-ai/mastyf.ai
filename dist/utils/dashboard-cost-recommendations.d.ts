import type { IDatabase } from '../database/database-interface.js';
export type CostRecommendation = {
    ruleName: string;
    description: string;
    reason: string;
    confidence: number;
    estimatedSavingsUsd: number;
    action: string;
};
export declare function buildCostRecommendations(db: IDatabase, tenantId: string, windowDays: number): Promise<CostRecommendation[]>;
//# sourceMappingURL=dashboard-cost-recommendations.d.ts.map