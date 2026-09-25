import type { Issue, ToolDefinition } from "./types.js";
/** @internal */
export declare function resetLocalSemanticRulesForTests(): void;
/** Reload learned overlay and bust compiled rule caches. */
export declare function reloadLearnedRules(): void;
export declare function isCoreLocalSemanticEnabled(): boolean;
/** Deterministic heuristic when no LLM API key is configured. */
export declare function runLocalSemanticFallback(tool: ToolDefinition): Issue[];
export { LOCAL_SEMANTIC_RULES, LOCAL_SEMANTIC_RULE_PROBES } from "./local-semantic-rules.js";
//# sourceMappingURL=local-semantic-fallback.d.ts.map