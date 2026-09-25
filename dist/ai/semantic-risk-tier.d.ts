export type SemanticRiskTier = 'low' | 'medium' | 'high';
export declare function classifySemanticRiskTier(toolName: string, args: unknown): SemanticRiskTier;
export declare function shouldFailClosedOnSemanticDegrade(tier: SemanticRiskTier): boolean;
//# sourceMappingURL=semantic-risk-tier.d.ts.map