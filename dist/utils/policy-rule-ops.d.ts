export type MutablePolicyRule = {
    name: string;
    action: 'pass' | 'block' | 'flag';
    description?: string;
    enabled?: boolean;
    tools?: {
        allow?: string[];
        deny?: string[];
    };
    patterns?: string[];
    argPatterns?: Array<{
        field: string;
        patterns: string[];
    }>;
};
export type ActiveRuleSummary = {
    name: string;
    action: 'pass' | 'block' | 'flag';
    enabled: boolean;
    description?: string;
    allowCount: number;
    denyCount: number;
    patternCount: number;
    argPatternCount: number;
};
export declare function listActiveRules(yaml: string): ActiveRuleSummary[];
export declare function togglePolicyRule(yaml: string, ruleName: string, enabled: boolean): string;
export declare function deletePolicyRule(yaml: string, ruleName: string): string;
//# sourceMappingURL=policy-rule-ops.d.ts.map