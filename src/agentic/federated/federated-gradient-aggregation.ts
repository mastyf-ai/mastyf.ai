/**
 * B3 — FedAvg-style gradient aggregation for federated threat model updates.
 */
import { applyDifferentialPrivacyNoise } from './federated-privacy.js';
import { FEDERATED_WEIGHT_DIM } from './federated-weight-aggregation.js';

export interface GradientContribution {
  gradient: number[];
  sampleCount: number;
}

/** Local SGD step for binary threat classifier (injection=1, benign=0). */
export function computeLocalGradient(
  features: number[],
  label: 0 | 1,
  weights: number[],
  learningRate = 0.05,
): number[] {
  const dim = Math.max(features.length, weights.length, FEDERATED_WEIGHT_DIM);
  const x = new Array(dim).fill(0);
  const w = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    x[i] = features[i] ?? 0;
    w[i] = weights[i] ?? 0;
  }
  let dot = 0;
  for (let i = 0; i < dim; i++) dot += x[i]! * w[i]!;
  const pred = 1 / (1 + Math.exp(-dot));
  const error = pred - label;
  return x.map(v => -learningRate * error * v);
}

/** Sample-weighted FedAvg with optional DP noise on each dimension. */
export function fedAvgGradients(
  contributions: GradientContribution[],
  epsilon = 1.0,
): number[] {
  if (contributions.length === 0) return [];
  const dim = Math.max(...contributions.map(c => c.gradient.length));
  const acc = new Array(dim).fill(0);
  let total = 0;
  for (const c of contributions) {
    const w = Math.max(1, c.sampleCount);
    for (let i = 0; i < c.gradient.length; i++) {
      acc[i] += c.gradient[i]! * w;
    }
    total += w;
  }
  return acc.map(v => {
    const avg = v / total;
    return applyDifferentialPrivacyNoise(avg * 100, epsilon) / 100;
  });
}

/** Apply aggregated gradient to current weight vector. */
export function applyGradientToWeights(weights: number[], gradient: number[]): number[] {
  const dim = Math.max(weights.length, gradient.length);
  const next = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    next[i] = Math.max(-1, Math.min(1, (weights[i] ?? 0) + (gradient[i] ?? 0)));
  }
  return next;
}
