export type LearningEventType = 'semantic_tp' | 'block_learning' | 'threat_research_write' | 'suggestion_queued' | 'threat_lab_triggered' | 'digest_generated' | 'autopilot_decision' | 'autopilot_rollout' | 'autopilot_rollback';
export type LearningEvent = {
    schemaVersion?: '2026-05-1';
    timestamp: string;
    type: LearningEventType;
    detail: string;
    fingerprint?: string;
    confidence?: number;
    tenantId?: string;
    metadata?: Record<string, unknown>;
};
export declare function appendLearningEvent(event: Omit<LearningEvent, 'timestamp'> & {
    timestamp?: string;
}, tenantId?: string): void;
export declare function readRecentLearningEvents(tenantId?: string, limit?: number): LearningEvent[];
export declare function countLearningEventsSince(type: LearningEventType, sinceMs: number, tenantId?: string): number;
//# sourceMappingURL=learning-events.d.ts.map