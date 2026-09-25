import { CallContext, PolicyDecision } from './policy-types.js';
export declare function resetOpaCacheForTests(): void;
/** Validate OPA decision document: { allow: boolean, reason?: string }. */
export declare function parseOpaResult(result: unknown): {
    ok: true;
    allow: boolean;
    reason?: string;
} | {
    ok: false;
    error: string;
};
/** Returns a block decision only — never a pass. YAML runs when this returns null. */
export declare function evaluateOpaPolicy(ctx: CallContext): Promise<PolicyDecision | null>;
//# sourceMappingURL=opa-policy.d.ts.map