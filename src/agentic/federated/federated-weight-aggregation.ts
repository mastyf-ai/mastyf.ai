/**
 * B3 — Secure weight-vector aggregation for federated threat models.
 * Derives fixed-dimension vectors from signature hashes and aggregates with sample-weighted averaging + DP noise.
 */
import { createHash } from 'crypto';
import { applyDifferentialPrivacyNoise } from './federated-privacy.js';

export const FEDERATED_WEIGHT_DIM = 32;

/** Deterministic embedding of a threat signature hash into a normalized weight vector. */
export function signatureToWeightVector(signatureHash: string, dim = FEDERATED_WEIGHT_DIM): number[] {
  const bytes = createHash('sha256').update(signatureHash).digest();
  const vec: number[] = [];
  for (let i = 0; i < dim; i++) {
    const b = bytes[i % bytes.length]!;
    vec.push((b / 127.5) - 1);
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

export interface WeightContribution {
  signatureHash: string;
  sampleCount: number;
}

/** Sample-weighted secure average with optional differential-privacy noise on the aggregate. */
export function secureAggregateWeightVectors(
  contributions: WeightContribution[],
  epsilon = 1.0,
): { weights: number[]; contributorCount: number } {
  if (contributions.length === 0) {
    return { weights: new Array(FEDERATED_WEIGHT_DIM).fill(0), contributorCount: 0 };
  }

  const dim = FEDERATED_WEIGHT_DIM;
  const acc = new Array(dim).fill(0);
  let totalWeight = 0;

  for (const c of contributions) {
    const w = Math.max(1, c.sampleCount);
    const vec = signatureToWeightVector(c.signatureHash, dim);
    for (let i = 0; i < dim; i++) {
      acc[i] += vec[i]! * w;
    }
    totalWeight += w;
  }

  const averaged = acc.map(v => v / totalWeight);
  const noisy = averaged.map(v => {
    const noisyVal = applyDifferentialPrivacyNoise(v * 100, epsilon) / 100;
    return Math.max(-1, Math.min(1, noisyVal));
  });

  return { weights: noisy, contributorCount: contributions.length };
}

/** Dot-product score against aggregated federated weights (inference hot path). */
export function scoreWithAggregatedWeights(features: number[], weights: number[]): number {
  if (!features.length || !weights.length) return 0.5;
  const dim = Math.min(features.length, weights.length);
  let dot = 0;
  for (let i = 0; i < dim; i++) {
    dot += features[i]! * weights[i]!;
  }
  return 1 / (1 + Math.exp(-dot));
}
