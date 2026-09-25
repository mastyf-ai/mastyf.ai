import { ProxyCallRecord } from '../types.js';
import { PolicyRule } from '../policy/policy-types.js';
import { CostAuditor } from '../services/cost-auditor.js';
import { HistoryDatabase } from '../database/history-db.js';
export interface CostPattern {
    toolName: string;
    serverName: string;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
    callCount: number;
    costPercentOfTotal: number;
    tokenTrend: 'increasing' | 'flat' | 'decreasing';
}
export interface CostSuggestion {
    rule: PolicyRule;
    confidence: number;
    reason: string;
    estimatedSavings: number;
    source: 'cost';
}
export declare class CostOptimizer {
    private db;
    private costAuditor;
    private budgetCap;
    constructor(db: HistoryDatabase, costAuditor: CostAuditor, budgetCap?: number);
    /** Analyze cost patterns from call records with pricing awareness */
    analyzePatterns(records: ProxyCallRecord[], inputPricePerM: number, outputPricePerM: number): Promise<CostPattern[]>;
    /** Detect burst patterns — tools with high variance in call frequency */
    detectBurstPatterns(records: ProxyCallRecord[]): Promise<Map<string, number>>;
    /** Generate cost-optimization policy suggestions */
    suggestRules(patterns: CostPattern[], burstMap?: Map<string, number>): CostSuggestion[];
    setBudgetCap(cap: number): void;
    getBudgetCap(): number;
}
//# sourceMappingURL=cost-optimizer.d.ts.map