/**
 * Agentic Telemetry — metrics and tracing for all autonomous AI features.
 *
 * Tracks:
 *   - Agentic decision counts, confidence distributions
 *   - Feature-specific metrics (policy generations, injection detections, etc.)
 *   - LLM usage and cost tracking
 *   - Task queue health
 */
import { Logger } from '../utils/logger.js';
const TOKEN_COST_PER_1K = {
    'gpt-4o': 0.005, // $5/1M input tokens
    'gpt-4o-mini': 0.00015, // $0.15/1M input tokens
    'claude-3-5-haiku': 0.0008,
    'claude-3-5-sonnet': 0.003,
    'default': 0.001,
};
export class AgenticTelemetry {
    decisions = [];
    startTime;
    totalLlmTokens = 0;
    totalLlmCost = 0;
    maxRecords;
    constructor(maxRecords = 10_000) {
        this.startTime = Date.now();
        this.maxRecords = maxRecords;
    }
    /** Record an agentic decision. */
    recordDecision(source, feature, decision, outcome = 'pending', metadata) {
        const record = {
            decisionId: decision.decisionId,
            source,
            feature,
            rationale: decision.rationale,
            confidence: decision.confidence,
            requiresApproval: decision.requiresApproval,
            suggestedAction: decision.suggestedAction,
            timestamp: decision.timestamp,
            outcome,
            metadata,
        };
        this.decisions.push(record);
        // Trim old records
        if (this.decisions.length > this.maxRecords) {
            this.decisions = this.decisions.slice(-this.maxRecords);
        }
        Logger.debug(`[AgenticTelemetry] Decision recorded: ${feature}/${decision.decisionId} confidence=${decision.confidence.toFixed(2)}`);
    }
    /** Track LLM token usage and estimated cost. */
    recordLlmUsage(model, tokensUsed) {
        this.totalLlmTokens += tokensUsed;
        const costPer1k = TOKEN_COST_PER_1K[model] || TOKEN_COST_PER_1K['default'];
        this.totalLlmCost += (tokensUsed / 1000) * costPer1k;
    }
    /** Get current metrics snapshot. */
    getMetrics(taskQueueStats) {
        const decisionsByFeature = {};
        let totalConfidence = 0;
        for (const d of this.decisions) {
            decisionsByFeature[d.feature] = (decisionsByFeature[d.feature] || 0) + 1;
            totalConfidence += d.confidence;
        }
        return {
            totalDecisions: this.decisions.length,
            decisionsByFeature,
            avgConfidence: this.decisions.length > 0 ? totalConfidence / this.decisions.length : 0,
            approvalsRequested: this.decisions.filter(d => d.requiresApproval).length,
            autoApplied: this.decisions.filter(d => d.outcome === 'auto_applied').length,
            llmTokensUsed: this.totalLlmTokens,
            llmCostEstimate: Math.round(this.totalLlmCost * 10000) / 10000,
            taskQueueStats: taskQueueStats || { queued: 0, running: 0, completed: 0, failed: 0 },
            uptimeMs: Date.now() - this.startTime,
        };
    }
    /** Get recent decisions (for dashboard display). */
    getRecentDecisions(limit = 50) {
        return this.decisions.slice(-limit).reverse();
    }
    /** Get decisions for a specific feature. */
    getDecisionsByFeature(feature, limit = 50) {
        return this.decisions.filter(d => d.feature === feature).slice(-limit).reverse();
    }
    /** Update a decision's outcome (e.g., when human approves/denies). */
    updateOutcome(decisionId, outcome) {
        const record = this.decisions.find(d => d.decisionId === decisionId);
        if (!record)
            return false;
        record.outcome = outcome;
        return true;
    }
    /** Reset all metrics (useful for testing). */
    reset() {
        this.decisions = [];
        this.totalLlmTokens = 0;
        this.totalLlmCost = 0;
        this.startTime = Date.now();
    }
}
//# sourceMappingURL=telemetry.js.map