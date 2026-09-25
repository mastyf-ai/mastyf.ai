/**
 * Post-policy allow gates shared across proxy transports (sync semantic request).
 * When the gateway arbiter is enabled, it is the authoritative decision; local
 * semantic sync remains a defense-in-depth layer when arbiter allows.
 */
import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
export interface PostPolicyGateBlock {
    block: true;
    rule: string;
    reason: string;
    metricCategory: 'semantic_sync_request' | 'gateway_arbiter';
    escalate?: boolean;
    cbacDecision?: string;
    difcDecision?: string;
    aiaDecision?: string;
}
export type PostPolicyGateResult = {
    block: false;
} | PostPolicyGateBlock;
export declare function runGatewayArbiterGate(context: CallContext, serverName: string): Promise<PostPolicyGateResult>;
export declare function runSyncSemanticRequestGate(context: CallContext, decision: PolicyDecision, serverName: string): Promise<PostPolicyGateResult>;
//# sourceMappingURL=proxy-post-policy-gates.d.ts.map