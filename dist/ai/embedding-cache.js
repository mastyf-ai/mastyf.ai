/**
 * Vector Semantic Cache
 *
 * Uses nomic-embed-text embeddings to compute cosine similarity against
 * previously evaluated verdicts. Provides sub-10ms cache hits for semantically
 * similar / paraphrased tool arguments without invoking generative LLMs.
 */
export function isEmbeddingCacheEnabled() {
    return process.env.MASTYF_AI_EMBEDDING_CACHE_ENABLED !== 'false';
}
export function getEmbeddingThreshold() {
    return process.env.MASTYF_AI_EMBEDDING_THRESHOLD
        ? parseFloat(process.env.MASTYF_AI_EMBEDDING_THRESHOLD)
        : 0.94;
}
export class EmbeddingCache {
    cache = new Map();
    maxEntries;
    threshold;
    ollamaUrl;
    constructor(options) {
        this.maxEntries = options?.maxEntries ?? 1000;
        this.threshold = options?.threshold ?? getEmbeddingThreshold();
        this.ollamaUrl =
            options?.ollamaUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
    }
    cosineSimilarity(a, b) {
        if (a.length !== b.length || a.length === 0)
            return 0;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }
    async getEmbedding(text) {
        try {
            const model = process.env.MASTYF_AI_EMBEDDING_MODEL || 'nomic-embed-text';
            const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    prompt: text.slice(0, 2048),
                }),
                signal: AbortSignal.timeout(100),
            });
            if (!res.ok)
                return null;
            const data = (await res.json());
            return data.embedding ?? null;
        }
        catch {
            return null;
        }
    }
    async findNearest(embeddingOrServer, toolNameOrThreshold, args) {
        let embedding = null;
        let threshold = this.threshold;
        if (Array.isArray(embeddingOrServer)) {
            embedding = embeddingOrServer;
            if (typeof toolNameOrThreshold === 'number')
                threshold = toolNameOrThreshold;
        }
        else {
            const prompt = `Server: ${embeddingOrServer}\nTool: ${toolNameOrThreshold}\nArgs: ${JSON.stringify(args || {})}`;
            embedding = await this.getEmbedding(prompt);
        }
        if (!embedding)
            return null;
        let bestScore = -1;
        let bestEntry = null;
        for (const entry of this.cache.values()) {
            const score = this.cosineSimilarity(embedding, entry.embedding);
            if (score > bestScore) {
                bestScore = score;
                bestEntry = entry;
            }
        }
        if (bestScore >= threshold && bestEntry) {
            return {
                hit: true,
                verdict: bestEntry.verdict,
                score: bestScore,
                similarity: bestScore,
                model: bestEntry.model || 'nomic-embed-text',
            };
        }
        return null;
    }
    async store(keyOrServer, embeddingOrTool, verdictOrArgs, verdictArg, model) {
        let key = keyOrServer;
        let embedding = null;
        let verdict;
        let modelName = model;
        if (Array.isArray(embeddingOrTool)) {
            embedding = embeddingOrTool;
            verdict = verdictOrArgs;
        }
        else {
            key = `${keyOrServer}:${embeddingOrTool}:${JSON.stringify(verdictOrArgs)}`;
            const prompt = `Server: ${keyOrServer}\nTool: ${embeddingOrTool}\nArgs: ${JSON.stringify(verdictOrArgs)}`;
            embedding = await this.getEmbedding(prompt);
            verdict = verdictArg;
        }
        if (!embedding || !verdict)
            return;
        if (this.cache.size >= this.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey)
                this.cache.delete(oldestKey);
        }
        this.cache.set(key, {
            embedding,
            verdict,
            model: modelName,
            timestamp: Date.now(),
        });
    }
    clear() {
        this.cache.clear();
    }
    size() {
        return this.cache.size;
    }
}
export const globalEmbeddingCache = new EmbeddingCache();
export function getEmbeddingCache() {
    return globalEmbeddingCache;
}
//# sourceMappingURL=embedding-cache.js.map