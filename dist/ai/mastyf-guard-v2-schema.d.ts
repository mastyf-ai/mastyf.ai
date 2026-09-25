/**
 * Mastyf Guard 1.5B v2: Argument-Aware Tool-Security Schema
 *
 * Formulates tool security as:
 * P(proposed action deviates from authorized intent and scope | T, theta, C, x)
 * with three-way operational verdicts: ALLOW | BLOCK | ESCALATE.
 */
export interface AuthorizedScopeEnvelope {
    /** Explicitly authorized entities, principals, or accounts */
    allowedEntities?: string[];
    /** Explicitly authorized network/email/webhook destinations */
    allowedDestinations?: string[];
    /** Maximum authorized privilege tiers (e.g. DeveloperAccess, ReadOnly) */
    allowedPrivileges?: string[];
    /** Permitted operational verbs */
    allowedOperations?: string[];
    /** Numeric ceilings (e.g. max payment amount) */
    maxThresholds?: Record<string, number>;
}
export interface ToolSecurityContext {
    /** The specific tool being dispatched */
    toolName: string;
    /** Formal JSON schema or parameter specification of the tool */
    toolSchema?: Record<string, unknown>;
    /** Principal identity invoking or delegating the action */
    authorizedPrincipal: string;
    /** The capability envelope granted to the active session */
    authorizedCapability: string | string[];
    /** Proposed arguments for the tool invocation */
    arguments: Record<string, unknown>;
    /** Full unconstrained context / retrieved untrusted content */
    context: string;
    /** Expected or benign action intended by the user/session */
    expectedAction: string;
    /** Structured authorized scope envelope */
    authorizedScope?: AuthorizedScopeEnvelope;
}
export type ToolSecurityCategory = 'benign' | 'authorization_anomaly' | 'destructive_action' | 'data_exfiltration' | 'parameter_poisoning';
export type MastyfVerdict = 'ALLOW' | 'BLOCK' | 'ESCALATE';
export interface MastyfGuardV2Prediction {
    /** Three-way operational verdict: ALLOW | BLOCK | ESCALATE */
    verdict: MastyfVerdict | 'SAFE' | 'BLOCKED';
    /** Continuous threat score in [0.0, 1.0] representing P(policy deviation) */
    threatScore: number;
    /** Primary classification head */
    primaryCategory: ToolSecurityCategory;
    /** Probability distribution across the 5 security classification heads */
    categoryProbabilities: {
        authorization_anomaly: number;
        destructive_action: number;
        data_exfiltration: number;
        parameter_poisoning: number;
        benign: number;
    };
    /** Specific parameter keys identified as malicious, manipulated, or out-of-scope */
    violatingParameters?: string[];
    /** Detailed policy deviation reasoning */
    policyDeviation?: {
        invariantViolated?: 'recipient_destination_deviation' | 'scope_expansion' | 'privilege_overgrant' | 'secondary_side_effect' | 'none';
        authorizedValue?: string;
        proposedValue?: string;
    };
    /** Human-interpretable explanation for SIEM audit logs */
    explanation: string;
    /** Latency breakdown in microseconds */
    latencyUs: number;
}
//# sourceMappingURL=mastyf-guard-v2-schema.d.ts.map