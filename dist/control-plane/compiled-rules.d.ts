import type { PolicyConfig } from '../policy/policy-types.js';
export declare const COMPILED_RULES_SCHEMA_VERSION = "v2";
export interface CompiledRulesBase {
    schemaVersion: string;
    generatedAt: string;
    sourcePolicyVersion: string;
    minProxyVersion: string;
    blockedTools: string[];
    allowedTools: string[];
    blockedMethodSubstrings: string[];
    policyMode: PolicyConfig['policy']['mode'];
    defaultAction: NonNullable<PolicyConfig['policy']['default_action']> | 'pass';
}
export interface CompiledRulesV2 extends CompiledRulesBase {
    schemaVersion: 'v2';
    tokensPerMinuteCap: number;
    usdPerMinuteCap: number;
}
export type CompiledRules = CompiledRulesV2;
export interface DecisionTelemetryEvent {
    schemaVersion: string;
    timestamp: string;
    requestId: string;
    toolName: string;
    action: 'pass' | 'block' | 'flag';
    reason: string;
    source: 'data-plane';
}
export declare function compilePolicyToRules(config: PolicyConfig): CompiledRules;
export declare function compiledRulesEtag(rules: CompiledRules): string;
//# sourceMappingURL=compiled-rules.d.ts.map