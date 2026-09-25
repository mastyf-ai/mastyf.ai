import { isAppAlertingConfigured } from './alert-env.js';
export interface IncidentContext {
    type: 'critical_block' | 'regression' | 'llm_offline' | 'block_spike';
    severity: 'critical' | 'high' | 'medium' | 'low';
    summary: string;
    details: Record<string, unknown>;
    timestamp: string;
}
export interface IncidentResponseResult {
    ok: boolean;
    channel: string;
    incidentId?: string;
    error?: string;
}
export { isAppAlertingConfigured };
/**
 * Dispatch an incident to all configured channels.
 * Critical/high severity → PagerDuty + ServiceNow + Slack
 * Medium/low severity → Slack + Jira (optional)
 */
export declare function respondToIncident(incident: IncidentContext): Promise<IncidentResponseResult[]>;
/** Trigger: critical block with high anomaly score. */
export declare function checkAndRespondToCriticalBlock(blockReason: string, anomalyScore: number, toolName: string, serverName: string): Promise<void>;
/** Trigger: detection regression detected by red-team analysis. */
export declare function checkAndRespondToRegression(currentRecall: number, baselineRecall: number, delta: number): Promise<void>;
/** Track LLM health and alert if offline > threshold minutes. */
export declare function trackLlmHealth(online: boolean): void;
/** Track block rate spikes. */
export declare function trackBlockSpike(blocked: boolean): void;
/** Reset state for tests. */
export declare function resetIncidentResponderForTests(): void;
//# sourceMappingURL=incident-responder.d.ts.map