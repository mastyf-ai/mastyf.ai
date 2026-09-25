export interface LlmCacheKeyInput {
    model: string;
    prompt: string;
    system: string;
    temperature: number;
}
/** Semantic audit cache input — keyed by normalized tool-call fingerprint, not full prompt text. */
export interface SemanticLlmCacheKeyInput {
    model: string;
    serverName: string;
    toolName: string;
    arguments?: Record<string, unknown>;
    temperature: number;
    tenantId?: string;
    policyMode?: string;
}
export declare function isLlmCacheEnabled(): boolean;
export declare function getLlmCache(): LlmCache;
export declare function resetLlmCacheForTests(): void;
export declare function hashSemanticAuditKey(input: SemanticLlmCacheKeyInput): string;
export declare function semanticToLlmCacheKey(input: SemanticLlmCacheKeyInput, system: string, userPrompt: string): LlmCacheKeyInput;
export declare class LlmCache {
    private readonly enabled;
    private readonly ttlMs;
    private readonly region;
    private readonly redisPrefix;
    private redis;
    private readonly lru;
    constructor();
    private storageKey;
    private redisKey;
    get(input: LlmCacheKeyInput): Promise<string | null>;
    set(input: LlmCacheKeyInput, value: string): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=llm-cache.d.ts.map