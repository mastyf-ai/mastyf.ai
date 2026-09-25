import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
/** Emit policy_decision audit + SIEM events for all proxy transports. */
export declare function auditPolicyDecision(requestId: string | number, serverName: string, toolName: string, decision: PolicyDecision, context: CallContext): void;
//# sourceMappingURL=audit-policy-decision.d.ts.map