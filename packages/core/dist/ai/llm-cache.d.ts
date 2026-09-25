export interface LlmCacheKeyInput {
    model: string;
    prompt: string;
    system: string;
    temperature: number;
    policyMode?: string;
    /** Bumped on policy hot-reload to invalidate stale verdicts (M-007). */
    policyVersion?: string;
    /** Engine scan mode — must differ so onlyOnHits vs thorough scans do not share verdicts. */
    onlyOnHits?: boolean;
    alwaysRun?: boolean;
}
export declare function isLlmCacheEnabled(): boolean;
export declare function getLlmCache(): LlmCache;
export declare function resetLlmCacheForTests(): void;
/** Clear in-memory and Redis LLM verdict cache after policy reload (M-007). */
export declare function invalidateLlmCache(): Promise<void>;
/** @internal Exposed for cache-key regression tests. */
export declare function hashLlmCacheKeyForTests(input: LlmCacheKeyInput): string;
export declare class LlmCache {
    private readonly enabled;
    private readonly ttlMs;
    private readonly redisPrefix;
    private redis;
    private readonly lru;
    hits: number;
    misses: number;
    constructor();
    private storageKey;
    private redisKey;
    get(input: LlmCacheKeyInput): Promise<string | null>;
    set(input: LlmCacheKeyInput, value: string): Promise<void>;
    close(): Promise<void>;
    clear(): Promise<void>;
}
//# sourceMappingURL=llm-cache.d.ts.map