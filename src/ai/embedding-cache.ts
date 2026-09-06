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

export function isEmbeddingCacheEnabled(): boolean {
  return process.env.MASTYF_AI_EMBEDDING_CACHE_ENABLED !== 'false';
}

export function getEmbeddingThreshold(): number {
  return process.env.MASTYF_AI_EMBEDDING_THRESHOLD
    ? parseFloat(process.env.MASTYF_AI_EMBEDDING_THRESHOLD)
    : 0.94;
}

interface EmbeddingEntry {
  embedding: number[];
  verdict: CachedVerdict;
  model?: string;
  timestamp: number;
}

export class EmbeddingCache {
  private cache = new Map<string, EmbeddingEntry>();
  private readonly maxEntries: number;
  private readonly threshold: number;
  private readonly ollamaUrl: string;

  constructor(options?: {
    maxEntries?: number;
    threshold?: number;
    ollamaUrl?: string;
  }) {
    this.maxEntries = options?.maxEntries ?? 1000;
    this.threshold = options?.threshold ?? getEmbeddingThreshold();
    this.ollamaUrl =
      options?.ollamaUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
  }

  public cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
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

  public async getEmbedding(text: string): Promise<number[] | null> {
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

      if (!res.ok) return null;
      const data = (await res.json()) as { embedding?: number[] };
      return data.embedding ?? null;
    } catch {
      return null;
    }
  }

  public async findNearest(
    embeddingOrServer: number[] | string,
    toolNameOrThreshold?: string | number,
    args?: Record<string, unknown>,
  ): Promise<EmbeddingCacheHit | null> {
    let embedding: number[] | null = null;
    let threshold = this.threshold;

    if (Array.isArray(embeddingOrServer)) {
      embedding = embeddingOrServer;
      if (typeof toolNameOrThreshold === 'number') threshold = toolNameOrThreshold;
    } else {
      const prompt = `Server: ${embeddingOrServer}\nTool: ${toolNameOrThreshold}\nArgs: ${JSON.stringify(args || {})}`;
      embedding = await this.getEmbedding(prompt);
    }

    if (!embedding) return null;

    let bestScore = -1;
    let bestEntry: EmbeddingEntry | null = null;

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

  public async store(
    keyOrServer: string,
    embeddingOrTool: number[] | string,
    verdictOrArgs: CachedVerdict | Record<string, unknown>,
    verdictArg?: CachedVerdict,
    model?: string,
  ): Promise<void> {
    let key = keyOrServer;
    let embedding: number[] | null = null;
    let verdict: CachedVerdict;
    let modelName = model;

    if (Array.isArray(embeddingOrTool)) {
      embedding = embeddingOrTool;
      verdict = verdictOrArgs as CachedVerdict;
    } else {
      key = `${keyOrServer}:${embeddingOrTool}:${JSON.stringify(verdictOrArgs)}`;
      const prompt = `Server: ${keyOrServer}\nTool: ${embeddingOrTool}\nArgs: ${JSON.stringify(verdictOrArgs)}`;
      embedding = await this.getEmbedding(prompt);
      verdict = verdictArg as CachedVerdict;
    }

    if (!embedding || !verdict) return;

    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      embedding,
      verdict,
      model: modelName,
      timestamp: Date.now(),
    });
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}

export const globalEmbeddingCache = new EmbeddingCache();

export function getEmbeddingCache(): EmbeddingCache {
  return globalEmbeddingCache;
}
