/**
 * Tribunal SLA settings from policy YAML (M-016). Env vars override policy.
 */
import type { TribunalTimeoutAction } from '../utils/tribunal-sla.js';
export interface TribunalPolicyConfig {
    timeout_ms?: number;
    timeout_action?: TribunalTimeoutAction;
}
export declare function setTribunalPolicyFromConfig(tribunal?: TribunalPolicyConfig): void;
export declare function getTribunalPolicyFromConfig(): TribunalPolicyConfig | null;
/** @internal */
export declare function resetTribunalPolicyForTests(): void;
//# sourceMappingURL=tribunal-policy.d.ts.map