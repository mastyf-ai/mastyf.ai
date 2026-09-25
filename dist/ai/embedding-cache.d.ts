/**
 * Vector Semantic Cache
 *
 * Uses nomic-embed-text embeddings to compute cosine similarity against
 * previously evaluated verdicts. Provides sub-10ms cache hits for semantically
 * similar / paraphrased tool arguments without invoking generative LLMs.
 */
export interface CachedVerdict {
    suspicious: boolean;
    confidence: number;
    categories: string[];
    reasoning?: string;
}
export interface EmbeddingCacheHit {
    hit: boolean;
    verdict: CachedVerdict;
    score?: number;
    similarity?: number;
    model?: string;
}
export declare function isEmbeddingCacheEnabled(): boolean;
export declare function getEmbeddingThreshold(): number;
export declare class EmbeddingCache {
    private cache;
    private readonly maxEntries;
    private readonly threshold;
    private readonly ollamaUrl;
    constructor(options?: {
        maxEntries?: number;
        threshold?: number;
        ollamaUrl?: string;
    });
    cosineSimilarity(a: number[], b: number[]): number;
    getEmbedding(text: string): Promise<number[] | null>;
    findNearest(embeddingOrServer: number[] | string, toolNameOrThreshold?: string | number, args?: Record<string, unknown>): Promise<EmbeddingCacheHit | null>;
    store(keyOrServer: string, embeddingOrTool: number[] | string, verdictOrArgs: CachedVerdict | Record<string, unknown>, verdictArg?: CachedVerdict, model?: string): Promise<void>;
    clear(): void;
    size(): number;
}
export declare const globalEmbeddingCache: EmbeddingCache;
export declare function getEmbeddingCache(): EmbeddingCache;
//# sourceMappingURL=embedding-cache.d.ts.map