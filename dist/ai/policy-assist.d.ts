import { PolicyRule } from '../policy/policy-types.js';
import { LlmAssistant } from './llm-assistant.js';
export interface PolicyGoal {
    raw: string;
    intent: 'tool_block' | 'tool_allow' | 'rate_limit' | 'token_budget' | 'pattern_block' | 'scope_restrict' | 'unknown';
    targets: string[];
    numericValue?: number;
    scope?: string;
}
export interface AssistSuggestion {
    rule: PolicyRule;
    confidence: number;
    reason: string;
    source: 'assist';
    goal: string;
}
/**
 * Policy-as-Code AI Assist — converts natural-language policy goals into
 * valid YAML-ready PolicyRule objects with regex patterns and RBAC configuration.
 */
export declare class PolicyAssist {
    private llm;
    constructor(llm?: LlmAssistant);
    /**
     * Generate a rule with LLM enhancement. Falls back to regex parsing if unavailable.
     */
    generateRuleWithLLM(goal: string, availableTools?: string[]): Promise<AssistSuggestion | null>;
    /**
     * Parse a natural-language goal into structured intent.
     */
    parseGoal(goal: string): PolicyGoal;
    /**
     * Generate a complete PolicyRule from a natural-language goal.
     */
    generateRule(goal: string, availableTools?: string[]): AssistSuggestion | null;
    /**
     * Generate YAML-ready string for a rule.
     */
    toYAML(rule: PolicyRule): string;
    private buildBlockRule;
    private buildAllowRule;
    private buildRateLimitRule;
    private buildTokenBudgetRule;
    private buildPatternBlockRule;
    private buildScopeRestrictRule;
    /**
     * Expand high-level concepts into specific regex patterns.
     */
    private expandPatterns;
    /**
     * Extract tool names from the goal string using common patterns.
     */
    private extractTools;
    /**
     * Resolve fuzzy tool names against known available tools.
     */
    private resolveTools;
}
//# sourceMappingURL=policy-assist.d.ts.map