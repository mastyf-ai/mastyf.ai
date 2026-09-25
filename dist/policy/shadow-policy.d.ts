import type { CallContext } from './policy-types.js';
export declare function resetShadowPolicyForTests(): void;
/** Evaluate shadow policy; never enforces — logs shadow_would_block when applicable. */
export declare function evaluateShadowPolicy(context: CallContext): Promise<void>;
//# sourceMappingURL=shadow-policy.d.ts.map