/**
 * Per-tool / per-field entropy overrides from policy YAML (M-004).
 */
import type { PolicyConfig } from './policy-types.js';
export interface EntropyFieldOverride {
    min_entropy?: number;
    allow_patterns?: string[];
}
export interface EntropyPolicyConfig {
    default_min?: number;
    safe_patterns?: string[];
    tools?: Record<string, {
        fields?: Record<string, EntropyFieldOverride>;
    }>;
}
export declare function setActiveEntropyPolicy(config: PolicyConfig | null): void;
export declare function isEntropySafeValue(value: string, toolName?: string, fieldName?: string): boolean;
export declare function minEntropyForContext(toolName?: string, fieldName?: string): number | undefined;
//# sourceMappingURL=entropy-policy.d.ts.map