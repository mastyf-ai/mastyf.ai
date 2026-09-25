export interface LocalSemanticScore {
    risk: number;
    suspicious: boolean;
    categories: string[];
    reasoning: string;
}
export declare function isLocalSemanticEnabled(tenantId?: string): boolean;
/** Score tool call risk 0–1 from arguments + metadata. */
export declare function scoreLocalSemanticRisk(input: {
    serverName: string;
    toolName: string;
    arguments?: Record<string, unknown>;
    syncRule?: string;
    tenantId?: string;
}): LocalSemanticScore;
/** Score arbitrary text (e.g. tool response body) with the same heuristic patterns. */
export declare function scoreLocalSemanticText(text: string, ctx: {
    serverName: string;
    toolName: string;
}): LocalSemanticScore;
/** @internal test helper */
export declare function clearLocalSemanticCacheForTests(): void;
//# sourceMappingURL=local-semantic-classifier.d.ts.map