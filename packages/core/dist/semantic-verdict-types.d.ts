export interface SemanticVerdict {
    is_injection: boolean;
    confidence: number;
    reasoning: string;
    categories: string[];
    severity: "critical" | "warning" | "none";
    specific_phrases: string[];
}
//# sourceMappingURL=semantic-verdict-types.d.ts.map