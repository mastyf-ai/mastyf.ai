/**
 * Synchronous semantic gate on tools/call requests (before forward to upstream).
 * Enterprise default ON when MASTYF_AI_ENTERPRISE_MODE=true and LLM configured.
 */
import type { CallContext } from '../policy/policy-types.js';
import type { PolicyDecision } from '../policy/policy-types.js';
import type { SemanticAuditResult } from './async-semantic-audit.js';
export declare function isSyncSemanticRequestEnabled(tenantId?: string): boolean;
export interface SyncSemanticRequestInput {
    context: CallContext;
    policyDecision: PolicyDecision;
}
export interface SyncSemanticRequestResult {
    block: boolean;
    result: SemanticAuditResult;
    source: 'local' | 'llm' | 'none';
    rule: string;
    reason: string;
}
export declare function evaluateSyncSemanticRequest(input: SyncSemanticRequestInput): Promise<SyncSemanticRequestResult>;
export type SemanticRequestGateStatus = 'enabled' | 'degraded' | 'disabled';
/** Health/readiness: enterprise sync request gate posture. */
export declare function getSemanticRequestGateStatus(tenantId?: string): {
    semanticRequestGate: SemanticRequestGateStatus;
    semantic_layer_active: boolean;
    llmConfigured: boolean;
    enterpriseMode: boolean;
};
//# sourceMappingURL=sync-semantic-request.d.ts.map