import type { PolicyConfig } from '../../policy/policy-types.js';
import { type PolicyCopilotSuggestion } from '../../ai/policy-copilot.js';
export type PolicyExplainSection = {
    title: string;
    summary: string;
};
export type PolicyNaturalLanguageSummary = {
    overview: string;
    sections: PolicyExplainSection[];
    ruleCount: number;
    mode: string;
    source: 'llm' | 'heuristic';
};
export type NaturalLanguageToPolicyResult = PolicyCopilotSuggestion & {
    source: 'semantic-translator';
};
export declare function loadPolicyConfig(path?: string): PolicyConfig | null;
/** YAML / PolicyConfig → plain-English summary for compliance stakeholders. */
export declare function policyToNaturalLanguage(input: PolicyConfig | string, opts?: {
    policyPath?: string;
    useLlm?: boolean;
}): Promise<PolicyNaturalLanguageSummary>;
/** Natural language goal → draft YAML rule with mandatory corpus replay. */
export declare function naturalLanguageToPolicy(goal: string, opts?: {
    availableTools?: string[];
    policyPath?: string;
    tenantId?: string;
    skipReplay?: boolean;
}): Promise<NaturalLanguageToPolicyResult | null>;
/** Explain a single rule or full policy file path. */
export declare function explainPolicyFile(policyPath?: string): Promise<PolicyNaturalLanguageSummary>;
//# sourceMappingURL=translator.d.ts.map