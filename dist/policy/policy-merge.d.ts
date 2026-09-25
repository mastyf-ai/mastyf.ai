import type { PolicyConfig } from './policy-types.js';
export declare function resolveHttpToolsPolicyPath(): string | null;
export declare function isHttpToolsPolicyMergeEnabled(): boolean;
/** Append HTTP tools SSRF rules from template when MASTYF_AI_HTTP_TOOLS_POLICY=true. */
export declare function mergeHttpToolsPolicy(base: PolicyConfig): PolicyConfig;
export declare function applyPolicyMerges(raw: PolicyConfig): PolicyConfig;
//# sourceMappingURL=policy-merge.d.ts.map