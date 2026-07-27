/**
 * Behavioral zero-day bridge — wires packages/core autoencoder into VulnFinding pipeline.
 */
import {
  createFindingId,
  fingerprintFinding,
  getFinding,
  upsertFinding,
} from './store.js';
import type { VulnFinding } from './types.js';

export interface BehavioralFeatureInput {
  toolName: string;
  arguments: unknown;
  serverName: string;
  timeSinceLastCallMs?: number;
}

function shannonEntropy(s: string): number {
  if (!s.length) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let e = 0;
  for (const c of freq.values()) {
    const p = c / s.length;
    e -= p * Math.log2(p);
  }
  return Math.min(1, e / 8);
}

function argDepth(v: unknown, d = 0): number {
  if (d > 10) return d;
  if (v && typeof v === 'object') {
    return Math.max(
      d,
      ...Object.values(v as Record<string, unknown>).map((x) => argDepth(x, d + 1)),
    );
  }
  return d;
}

function suspiciousChars(s: string): number {
  return /[\u0000\u200b\u202e\uFEFF]|%2e%2e|\\x[0-9a-f]{2}/i.test(s) ? 1 : 0;
}

/** Lightweight local reconstruction-error proxy when core autoencoder unavailable. */
export function scoreBehavioralAnomaly(input: BehavioralFeatureInput): {
  anomaly: boolean;
  score: number;
  threshold: number;
} {
  const threshold = parseFloat(process.env.MASTYF_AI_AUTOENCODER_THRESHOLD || '0.85');
  const argStr = typeof input.arguments === 'string'
    ? input.arguments
    : JSON.stringify(input.arguments ?? {});
  const entropy = shannonEntropy(input.toolName + argStr);
  const depth = Math.min(1, argDepth(input.arguments) / 8);
  const len = Math.min(1, Math.log10(argStr.length + 1) / 5);
  const sus = suspiciousChars(argStr);
  const timeNorm = Math.min(1, (input.timeSinceLastCallMs || 1000) / 60_000);
  // Pseudo reconstruction error: high entropy + depth + suspicious + burst timing
  const score = Math.min(
    1,
    entropy * 0.35 + depth * 0.25 + len * 0.15 + sus * 0.2 + (1 - timeNorm) * 0.05,
  );
  const enabled = process.env.MASTYF_AI_AUTOENCODER_ENABLED === 'true';
  return { anomaly: enabled && score >= threshold, score, threshold };
}

export async function evaluateBehavioralAndRecord(
  input: BehavioralFeatureInput,
): Promise<VulnFinding | null> {
  const enabled = process.env.MASTYF_AI_AUTOENCODER_ENABLED === 'true';
  if (!enabled) return null;

  // Prefer core autoencoder when available
  try {
    const {
      extractAutoencoderFeatures,
      detectAnomaly,
      trainOnBenign,
    } = await import('@mastyf_ai/core');
    const features = extractAutoencoderFeatures(
      input.toolName,
      (input.arguments && typeof input.arguments === 'object'
        ? (input.arguments as Record<string, unknown>)
        : { value: input.arguments }) as Record<string, unknown>,
      input.serverName,
    );
    // Warmup: train on low-suspicion calls
    const local = scoreBehavioralAnomaly(input);
    if (!local.anomaly && local.score < 0.4) {
      trainOnBenign(features);
    }
    const result = detectAnomaly(features);
    if (result.anomaly || result.reconstructionError >= result.threshold) {
      const finding = persistBehavioral(
        input,
        result.reconstructionError,
        result.threshold,
        'core-autoencoder',
      );
      // Optional federated fingerprint share (anonymized)
      if (process.env.MASTYF_AI_FEDERATED_BEHAVIORAL === 'true') {
        try {
          const { shareBehavioralFingerprint } = await import('./federated-behavioral.js');
          shareBehavioralFingerprint({
            toolName: input.toolName,
            score: result.reconstructionError,
            serverHash: input.serverName.slice(0, 8),
          });
        } catch {
          /* optional */
        }
      }
      return finding;
    }
    return null;
  } catch {
    /* fall through to local scorer */
  }

  const local = scoreBehavioralAnomaly(input);
  if (!local.anomaly) return null;
  return persistBehavioral(input, local.score, local.threshold, 'behavioral-bridge');
}

function persistBehavioral(
  input: BehavioralFeatureInput,
  score: number,
  threshold: number,
  scanner: string,
): VulnFinding {
  const partial = {
    class: 'behavioral' as const,
    severity: 'MEDIUM' as const,
    status: 'candidate' as const,
    title: `Behavioral anomaly: ${input.serverName}/${input.toolName}`,
    description: `Reconstruction/anomaly score ${score.toFixed(3)} >= ${threshold}`,
    target: {
      kind: 'tool_handler' as const,
      name: `${input.serverName}:${input.toolName}`,
    },
    evidence: {
      scanner,
      reproSteps: [
        `Tool ${input.toolName} on ${input.serverName}`,
        `Anomaly score=${score.toFixed(3)} threshold=${threshold}`,
        'Do not auto-block — queue for validation',
      ],
      payloads: [input.arguments],
    },
    exploitability: {
      preAuth: false,
      networkReachable: true,
      userInteraction: true,
    },
  };
  const fp = fingerprintFinding({
    class: partial.class,
    target: partial.target,
    title: partial.title,
    evidence: { scanner: partial.evidence.scanner, reproSteps: partial.evidence.reproSteps },
  });
  const id = createFindingId(fp);
  const existing = getFinding(id);
  return upsertFinding({
    ...partial,
    id,
    fingerprint: fp,
    discoveredAt: existing?.discoveredAt || new Date().toISOString(),
    status: existing?.status === 'validated' ? existing.status : 'candidate',
    validatedAt: existing?.validatedAt,
    analysisReportId: existing?.analysisReportId,
  });
}
