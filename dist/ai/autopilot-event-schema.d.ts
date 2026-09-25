export type AutopilotEventKind = 'threat' | 'decision' | 'rollout';
export interface AutopilotEventEnvelope<TPayload = Record<string, unknown>> {
    schemaVersion: '2026-05-1';
    kind: AutopilotEventKind;
    eventId: string;
    tenantId: string;
    timestamp: string;
    payload: TPayload;
}
export interface ThreatEventPayload {
    threatId: string;
    source: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    signature?: string;
    confidence: number;
}
export interface DecisionEventPayload {
    suggestionId: string;
    ruleName: string;
    action: 'approved' | 'rejected' | 'auto_applied' | 'rolled_back';
    actor: string;
    confidence: number;
}
export interface RolloutEventPayload {
    suggestionId: string;
    ruleName: string;
    stage: 'shadow' | 'canary' | 'enforce' | 'rollback';
    success: boolean;
    replayCoverage: number;
    canarySizePercent: number;
    predictedFpDelta: number;
    predictedBypassDelta: number;
}
export declare function makeThreatEvent(tenantId: string, payload: ThreatEventPayload): AutopilotEventEnvelope<ThreatEventPayload>;
export declare function makeDecisionEvent(tenantId: string, payload: DecisionEventPayload): AutopilotEventEnvelope<DecisionEventPayload>;
export declare function makeRolloutEvent(tenantId: string, payload: RolloutEventPayload): AutopilotEventEnvelope<RolloutEventPayload>;
//# sourceMappingURL=autopilot-event-schema.d.ts.map