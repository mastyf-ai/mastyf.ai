/**
 * Agentic Telemetry — metrics and tracing for all autonomous AI features.
 *
 * Tracks:
 *   - Agentic decision counts, confidence distributions
 *   - Feature-specific metrics (policy generations, injection detections, etc.)
 *   - LLM usage and cost tracking
 *   - Task queue health
 */
import type { AgenticDecision } from './core.js';
export interface AgenticDecisionRecord {
    decisionId: string;
    source: string;
    feature: string;
    rationale: string;
    confidence: number;
    requiresApproval: boolean;
    suggestedAction: string;
    timestamp: string;
    outcome?: 'approved' | 'denied' | 'auto_applied' | 'pending';
    metadata?: Record<string, unknown>;
}
export interface AgenticMetrics {
    /** Total decisions made */
    totalDecisions: number;
    /** Decisions by feature */
    decisionsByFeature: Record<string, number>;
    /** Average confidence */
    avgConfidence: number;
    /** Decisions requiring approval */
    approvalsRequested: number;
    /** Auto-applied decisions */
    autoApplied: number;
    /** LLM tokens used */
    llmTokensUsed: number;
    /** LLM cost estimate in USD */
    llmCostEstimate: number;
    /** Task queue stats */
    taskQueueStats: {
        queued: number;
        running: number;
        completed: number;
        failed: number;
    };
    /** Uptime since agentic start */
    uptimeMs: number;
}
export declare class AgenticTelemetry {
    private decisions;
    private startTime;
    private totalLlmTokens;
    private totalLlmCost;
    private maxRecords;
    constructor(maxRecords?: number);
    /** Record an agentic decision. */
    recordDecision(source: string, feature: string, decision: AgenticDecision, outcome?: AgenticDecisionRecord['outcome'], metadata?: Record<string, unknown>): void;
    /** Track LLM token usage and estimated cost. */
    recordLlmUsage(model: string, tokensUsed: number): void;
    /** Get current metrics snapshot. */
    getMetrics(taskQueueStats?: {
        queued: number;
        running: number;
        completed: number;
        failed: number;
    }): AgenticMetrics;
    /** Get recent decisions (for dashboard display). */
    getRecentDecisions(limit?: number): AgenticDecisionRecord[];
    /** Get decisions for a specific feature. */
    getDecisionsByFeature(feature: string, limit?: number): AgenticDecisionRecord[];
    /** Update a decision's outcome (e.g., when human approves/denies). */
    updateOutcome(decisionId: string, outcome: AgenticDecisionRecord['outcome']): boolean;
    /** Reset all metrics (useful for testing). */
    reset(): void;
}
//# sourceMappingURL=telemetry.d.ts.map