/**
 * A1 — Graph-based causal confidence scoring (heuristic + lightweight graph neural layer).
 */
import type { FleetChainEvent } from './fleet-chain-detector.js';

const ENCODE_HINT = /\b(?:base64|btoa|encode|hex|rot13|gzip|compress)\b/i;
const EXFIL_HINT = /\b(?:webhook|callback|post|upload|send|forward|https?:\/\/)\b/i;
const SENSITIVE_HINT = /\b(?:\/etc\/passwd|\.env|\.ssh|id_rsa|credentials|secret|token|api[_-]?key)\b/i;

const FEATURE_DIM = 8;

function loadGraphWeights(): { w1: number[]; w2: number[] } {
  try {
    const raw = process.env.GUARDIAN_FLEET_GRAPH_WEIGHTS?.trim();
    if (raw) {
      const parsed = JSON.parse(raw) as { w1?: number[]; w2?: number[] };
      if (parsed.w1?.length && parsed.w2?.length) {
        return { w1: parsed.w1, w2: parsed.w2 };
      }
    }
  } catch {
    // fall through to defaults
  }
  return {
    w1: [0.35, 0.28, 0.42, 0.15, 0.22, 0.18, 0.12, 0.25],
    w2: [0.45, 0.38, 0.52, 0.20, 0.30, 0.25, 0.18, 0.32],
  };
}

function eventFeatureVector(e: FleetChainEvent): number[] {
  const argsStr = JSON.stringify(e.argumentsSnapshot ?? {});
  const tool = e.toolName.toLowerCase();
  return [
    /read|list|search|get/i.test(tool) || SENSITIVE_HINT.test(argsStr) ? 1 : 0,
    /exec|bash|run|encode|python|node/i.test(tool) || ENCODE_HINT.test(argsStr) ? 1 : 0,
    /http|webhook|upload|fetch|curl|post|send/i.test(tool) || EXFIL_HINT.test(argsStr) ? 1 : 0,
    e.blocked ? 1 : 0,
    Math.min(1, argsStr.length / 512),
    e.eventType === 'tool_call' ? 1 : 0.5,
    e.serverName ? 1 : 0,
    Math.min(1, (e.timestamp % 60_000) / 60_000),
  ];
}

function relu(x: number): number {
  return x > 0 ? x : 0;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Two-hop message passing over temporal adjacency (GNN analog). */
function graphNeuralLayer(
  events: FleetChainEvent[],
  weightOverride?: { w1: number[]; w2: number[] },
): number {
  if (events.length === 0) return 0;
  const n = events.length;
  const X: number[][] = events.map(eventFeatureVector);

  const { w1: W1, w2: W2 } = weightOverride ?? loadGraphWeights();

  const H1: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const adj = j === i ? 1 : (events[j]!.timestamp <= events[i]!.timestamp && events[i]!.timestamp - events[j]!.timestamp < 120_000 ? 0.6 : 0);
      if (adj > 0) {
        for (let f = 0; f < FEATURE_DIM; f++) {
          sum += adj * X[j]![f]! * W1[f]!;
        }
      }
    }
    H1[i] = relu(sum / n);
  }

  let readScore = 0;
  let exfilScore = 0;
  for (let i = 0; i < n; i++) {
    let h2 = 0;
    for (let f = 0; f < FEATURE_DIM; f++) {
      h2 += X[i]![f]! * W2[f]!;
    }
    h2 = sigmoid(h2 + H1[i]!);
    if (X[i]![0]! > 0) readScore = Math.max(readScore, h2);
    if (X[i]![2]! > 0) exfilScore = Math.max(exfilScore, h2);
  }

  return readScore * exfilScore;
}

/** Boost chain confidence when argument snapshots show causal read→encode→exfil flow. */
export function scoreCausalGraphConfidence(events: FleetChainEvent[], baseConfidence: number): number {
  if (events.length < 2) return baseConfidence;

  let hasSensitiveRead = false;
  let hasEncode = false;
  let hasExfil = false;
  const crossServer = new Set(events.map(e => e.serverName)).size >= 2;

  for (const e of events) {
    const argsStr = JSON.stringify(e.argumentsSnapshot ?? {});
    const tool = e.toolName.toLowerCase();
    if (/read|list|search|get/i.test(tool) || SENSITIVE_HINT.test(argsStr)) hasSensitiveRead = true;
    if (/exec|bash|run|encode|python|node/i.test(tool) || ENCODE_HINT.test(argsStr)) hasEncode = true;
    if (/http|webhook|upload|fetch|curl|post|send/i.test(tool) || EXFIL_HINT.test(argsStr)) hasExfil = true;
  }

  let boost = 0;
  if (hasSensitiveRead && hasExfil) boost += 0.08;
  if (hasSensitiveRead && hasEncode && hasExfil) boost += 0.12;
  if (crossServer) boost += 0.05;

  return Math.min(0.99, Math.round((baseConfidence + boost) * 1000) / 1000);
}

/** Export normalized feature matrix for optional offline GNN training (A1). */
export function exportGraphFeatures(events: FleetChainEvent[]): number[][] {
  return events.map(eventFeatureVector);
}

export function computeGraphNeuralScore(events: FleetChainEvent[], baseConfidence: number): number {
  const heuristic = scoreCausalGraphConfidence(events, baseConfidence);
  const gnnSignal = graphNeuralLayer(events);
  const gnnBoost = gnnSignal > 0.5 ? (gnnSignal - 0.5) * 0.2 : 0;
  return Math.min(0.99, Math.round((heuristic + gnnBoost) * 1000) / 1000);
}

/** Supervised weight tuning from labeled fleet chain events (A1 training export). */
export function trainGraphWeightsFromEvents(
  samples: Array<{ events: FleetChainEvent[]; label: 0 | 1 }>,
  epochs = 8,
  learningRate = 0.05,
): { w1: number[]; w2: number[] } {
  const weights = loadGraphWeights();
  for (let e = 0; e < epochs; e++) {
    for (const sample of samples) {
      const signal = graphNeuralLayer(sample.events, weights);
      const error = signal - sample.label;
      for (let i = 0; i < weights.w1.length; i++) {
        weights.w1[i] = (weights.w1[i] ?? 0) - learningRate * error * 0.1;
        weights.w2[i] = (weights.w2[i] ?? 0) - learningRate * error * 0.1;
      }
    }
  }
  return weights;
}
