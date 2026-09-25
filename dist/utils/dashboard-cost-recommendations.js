import { CostOptimizer } from '../ai/cost-optimizer.js';
import { CostAuditor } from '../services/cost-auditor.js';
import { loadAllRecordsInWindow } from './cost-timeseries.js';
export async function buildCostRecommendations(db, tenantId, windowDays) {
    const records = await loadAllRecordsInWindow(db, tenantId, windowDays);
    if (records.length === 0)
        return [];
    const costAuditor = new CostAuditor(undefined, db, undefined, tenantId);
    const optimizer = new CostOptimizer(db, costAuditor);
    const patterns = await optimizer.analyzePatterns(records, 3, 15);
    const burstMap = await optimizer.detectBurstPatterns(records);
    const suggestions = optimizer.suggestRules(patterns, burstMap);
    return suggestions.slice(0, 12).map((s) => ({
        ruleName: s.rule.name || 'cost-suggestion',
        description: s.rule.description || '',
        reason: s.reason,
        confidence: s.confidence,
        estimatedSavingsUsd: s.estimatedSavings,
        action: String(s.rule.action || 'flag'),
    }));
}
//# sourceMappingURL=dashboard-cost-recommendations.js.map