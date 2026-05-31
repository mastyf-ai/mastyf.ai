/**
 * A3 — Agent Behavioral Biometrics: timing, shape, and tool-order fingerprints.
 */
import { createHash } from 'crypto';
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';

export interface BehaviorObservation {
  agentId: string;
  toolName: string;
  argBytes: number;
  interCallMs?: number;
  timestamp: number;
  credentialIdentity?: string;
}

export interface BehaviorFingerprint {
  agentId: string;
  sampleCount: number;
  avgInterCallMs: number;
  avgArgBytes: number;
  toolOrder: string[];
  argShapeHash: string;
  updatedAt: string;
}

export interface AnomalyResult {
  score: number;
  reason: string;
  blocked: boolean;
}

const MIN_SAMPLES_DEFAULT = 50;
const ANOMALY_THRESHOLD = 0.72;

function minSamplesRequired(): number {
  const parsed = parseInt(process.env.GUARDIAN_BIOMETRICS_MIN_SAMPLES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MIN_SAMPLES_DEFAULT;
}

function shapeHash(toolName: string, argBytes: number): string {
  return createHash('sha256').update(`${toolName}:${Math.round(argBytes / 64)}`).digest('hex').slice(0, 16);
}

export class BehaviorFingerprintEngine {
  private fingerprints = new Map<string, BehaviorFingerprint>();
  private lastCallAt = new Map<string, number>();
  private credentialBindings = new Map<string, string>();

  constructor(private readonly store?: IndustryStandardStore) {}

  observe(obs: BehaviorObservation): BehaviorFingerprint {
    const prev = this.fingerprints.get(obs.agentId) ?? this.store?.getBehaviorFingerprint?.(obs.agentId);
    const interCallMs = obs.interCallMs ?? (() => {
      const last = this.lastCallAt.get(obs.agentId);
      return last ? obs.timestamp - last : 0;
    })();
    this.lastCallAt.set(obs.agentId, obs.timestamp);

    const sampleCount = (prev?.sampleCount ?? 0) + 1;
    const avgInterCallMs = prev
      ? (prev.avgInterCallMs * (sampleCount - 1) + interCallMs) / sampleCount
      : interCallMs;
    const avgArgBytes = prev
      ? (prev.avgArgBytes * (sampleCount - 1) + obs.argBytes) / sampleCount
      : obs.argBytes;

    const toolOrder = [...(prev?.toolOrder ?? []), obs.toolName].slice(-20);
    const argShapeHash = shapeHash(obs.toolName, obs.argBytes);

    const fp: BehaviorFingerprint = {
      agentId: obs.agentId,
      sampleCount,
      avgInterCallMs,
      avgArgBytes,
      toolOrder,
      argShapeHash,
      updatedAt: new Date(obs.timestamp).toISOString(),
    };
    this.fingerprints.set(obs.agentId, fp);
    this.store?.saveBehaviorFingerprint?.(fp);
    if (obs.credentialIdentity) {
      const bound = this.credentialBindings.get(obs.agentId);
      if (!bound) this.credentialBindings.set(obs.agentId, obs.credentialIdentity);
    }
    return fp;
  }

  scoreAnomaly(agentId: string, obs: BehaviorObservation): AnomalyResult {
    const baseline = this.fingerprints.get(agentId) ?? this.store?.getBehaviorFingerprint?.(agentId);
    const minSamples = minSamplesRequired();
    if (!baseline || baseline.sampleCount < minSamples) {
      return { score: 0, reason: `Insufficient baseline (${baseline?.sampleCount ?? 0}/${minSamples} samples)`, blocked: false };
    }

    let score = 0;
    const reasons: string[] = [];

    const boundIdentity = this.credentialBindings.get(agentId);
    if (obs.credentialIdentity && boundIdentity && obs.credentialIdentity !== boundIdentity) {
      score += 0.45;
      reasons.push(`Credential identity ${obs.credentialIdentity} differs from behavioral baseline ${boundIdentity}`);
    }

    const interCallMs = obs.interCallMs ?? 0;
    if (interCallMs > 0 && baseline.avgInterCallMs > 0) {
      const ratio = interCallMs / baseline.avgInterCallMs;
      if (ratio > 3 || ratio < 0.25) {
        score += 0.35;
        reasons.push(`Inter-call timing deviates (${Math.round(ratio * 100)}% of baseline)`);
      }
    }

    if (baseline.avgArgBytes > 0) {
      const argRatio = obs.argBytes / baseline.avgArgBytes;
      if (argRatio > 4 || argRatio < 0.2) {
        score += 0.25;
        reasons.push('Argument size profile mismatch');
      }
    }

    const newShape = shapeHash(obs.toolName, obs.argBytes);
    if (baseline.argShapeHash && newShape !== baseline.argShapeHash && baseline.sampleCount >= minSamplesRequired()) {
      score += 0.2;
      reasons.push('Argument shape fingerprint mismatch');
    }

    const recentTools = baseline.toolOrder.slice(-5);
    if (recentTools.length >= 3 && !recentTools.includes(obs.toolName)) {
      score += 0.15;
      reasons.push('Unusual tool in sequence');
    }

    score = Math.min(1, score);
    const blocked = score >= ANOMALY_THRESHOLD;
    const reason = reasons.length ? reasons.join('; ') : 'Within baseline';

    if (score >= 0.5) {
      this.store?.saveBehaviorAnomaly?.({
        agentId,
        anomalyScore: score,
        reason,
        observation: obs,
        blocked,
      });
    }

    return { score, reason, blocked };
  }

  getFingerprint(agentId: string): BehaviorFingerprint | null {
    return this.fingerprints.get(agentId) ?? this.store?.getBehaviorFingerprint?.(agentId) ?? null;
  }

  listAnomalies(limit = 50): Array<{ agentId: string; anomalyScore: number; reason: string; createdAt: string }> {
    return this.store?.listBehaviorAnomalies?.(limit) ?? [];
  }
}

export function resetBehaviorFingerprintEngineForTests(): void {
  // no-op singleton reset hook for tests
}
