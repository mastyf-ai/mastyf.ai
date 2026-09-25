/**
 * Deterministic heuristic rules for tool-description semantic fallback (no LLM).
 * High-signal patterns only — tuned for MCP tool name/description text, not runtime args.
 * Keep regex quantifiers bounded for ReDoS safety.
 */
export type LocalSemanticRuleDef = {
    id: string;
    category: string;
    severity: "critical" | "warning";
    weight: number;
    regex: string;
    message: string;
};
export declare const LOCAL_SEMANTIC_RULES: LocalSemanticRuleDef[];
/** Probe strings for regression tests — one per rule ID. */
export declare const LOCAL_SEMANTIC_RULE_PROBES: Record<string, string>;
//# sourceMappingURL=local-semantic-rules.d.ts.map