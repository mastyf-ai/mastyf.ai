/**
 * Vector semantic cache — L2 cache using nomic-embed-text embeddings.
 * L1 is exact SHA256 (llm-cache.ts), L2 is cosine similarity on embeddings.
 * Falls back to LLM on miss; graceful no-op if Ollama embeddings unavailable.
 */
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { Logger } from '../utils/logger.js';
import { getLlmConfig } from '../config/llm-config.js';
import { resolveOllamaBaseUrl } from './llm-assistant.js';

export interface EmbeddingCacheHit {
  verdict: { suspicious: boolean; confidence: number; categories: string[]; reasoning: string };
  similarity: number;
  model: string;
}

interface StoredEmbedding {
  embedding: number[];
  verdict: EmbeddingCacheHit['verdict'];
  model: string;
  timestamp: number;
}

const DEFAULT_THRESHOLD = 0.94;
const DEFAULT_MODEL = 'nomic-embed-text';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const LRU_MAX = 1000;
const EMBEDDING_TIMEOUT_MS = 3000;

let sharedEmbeddingCache: EmbeddingCache | null = null;

export function getEmbeddingModel(): string {
  return process.env.MASTYF_AI_EMBEDDING_MODEL || DEFAULT_MODEL;
}

export function getEmbeddingThreshold(): number {
  const raw = parseFloat(process.env.MASTYF_AI_EMBEDDING_THRESHOLD || String(DEFAULT_THRESHOLD));
  if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
  return DEFAULT_THRESHOLD;
}

export function isEmbeddingCacheEnabled(): boolean {
  if (process.env.MASTYF_AI_EMBEDDING_CACHE === 'false') return false;
  if (process.env.MASTYF_AI_EMBEDDING_MODEL) return true;
  // Auto-enable when Ollama is the provider (local-first)
  const cfg = getLlmConfig();
  return cfg.provider === 'ollama';
}

export function getEmbeddingCache(): EmbeddingCache {
  if (!sharedEmbeddingCache) sharedEmbeddingCache = new EmbeddingCache();
  return sharedEmbeddingCache;
}

export function resetEmbeddingCacheForTests(): void {
  sharedEmbeddingCache = null;
}

function cosineSimilarity(a: number[], b: number[]): number {
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
  if (denom === 0) return 0;
  return dot / denom;
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/** Normalize arg text for embedding — same as llm-cache normalizeArgLeaves. */
function normalizeForEmbedding(serverName: string, toolName: string, args?: Record<string, unknown>): string {
  const parts: string[] = [`${serverName}::${toolName}`];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  if (args) walk(args);
  return parts.join('\n').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 4000);
}

export class EmbeddingCache {
  private readonly lru: LRUCache<string, StoredEmbedding>;
  private ollamaUrl: string;

  constructor() {
    this.ollamaUrl = resolveOllamaBaseUrl(getLlmConfig().ollamaBaseUrl);
    this.lru = new LRUCache<string, StoredEmbedding>({
      max: LRU_MAX,
      ttl: CACHE_TTL_MS,
      updateAgeOnGet: false,
    });
  }

  async getEmbedding(text: string): Promise<number[] | null> {
    if (!text.trim()) return null;
    const model = getEmbeddingModel();
    try {
      const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
        signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      });
      if (!res.ok) {
        Logger.debug(`[embedding-cache] embeddings API ${res.status} for model ${model}`);
        return null;
      }
      const data = (await res.json()) as { embedding?: number[] };
      if (!Array.isArray(data.embedding) || data.embedding.length === 0) return null;
      return l2Normalize(data.embedding);
    } catch (err) {
      Logger.debug(`[embedding-cache] embedding fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async findNearest(
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>,
    threshold?: number,
  ): Promise<EmbeddingCacheHit | null> {
    const text = normalizeForEmbedding(serverName, toolName, args);
    const embedding = await this.getEmbedding(text);
    if (!embedding) return null;
    const th = threshold ?? getEmbeddingThreshold();
    let best: { key: string; entry: StoredEmbedding; sim: number } | null = null;
    for (const [key, entry] of this.lru.entries()) {
      const sim = cosineSimilarity(embedding, entry.embedding);
      if (sim >= th && (!best || sim > best.sim)) {
        best = { key, entry, sim };
      }
    }
    if (!best) return null;
    return { verdict: best.entry.verdict, similarity: best.sim, model: best.entry.model };
  }

  async findNearestByEmbedding(
    embedding: number[],
    threshold?: number,
  ): Promise<EmbeddingCacheHit | null> {
    const th = threshold ?? getEmbeddingThreshold();
    let best: { entry: StoredEmbedding; sim: number } | null = null;
    for (const entry of this.lru.values()) {
      const sim = cosineSimilarity(embedding, entry.embedding);
      if (sim >= th && (!best || sim > best.sim)) {
        best = { entry, sim };
      }
    }
    if (!best) return null;
    return { verdict: best.entry.verdict, similarity: best.sim, model: best.entry.model };
  }

  async store(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    verdict: EmbeddingCacheHit['verdict'],
    model: string,
  ): Promise<void> {
    const text = normalizeForEmbedding(serverName, toolName, args);
    const embedding = await this.getEmbedding(text);
    if (!embedding) return;
    const key = createHash('sha256').update(text).digest('hex');
    this.lru.set(key, { embedding, verdict, model, timestamp: Date.now() });
  }

  /** Store with precomputed embedding (avoids second API call). */
  storeWithEmbedding(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    embedding: number[],
    verdict: EmbeddingCacheHit['verdict'],
    model: string,
  ): void {
    const text = normalizeForEmbedding(serverName, toolName, args);
    const key = createHash('sha256').update(text).digest('hex');
    this.lru.set(key, { embedding: l2Normalize(embedding), verdict, model, timestamp: Date.now() });
  }

  get size(): number {
    return this.lru.size;
  }

  clear(): void {
    this.lru.clear();
  }
}
