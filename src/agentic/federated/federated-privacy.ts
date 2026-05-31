/**
 * B3 — Federated delta privacy per THREAT_MESH_PRIVACY.md (ε-DP + threshold gating).
 */
import { createHash } from 'crypto';

export interface FederatedPrivacyConfig {
  epsilon: number;
  minReports: number;
}

export function federatedPrivacyConfig(): FederatedPrivacyConfig {
  return {
    epsilon: Number(process.env.GUARDIAN_FEDERATED_LEARNING_EPSILON ?? process.env.GUARDIAN_THREAT_MESH_EPSILON ?? '1.0'),
    minReports: Number(process.env.GUARDIAN_FEDERATED_LEARNING_MIN_REPORTS ?? process.env.GUARDIAN_THREAT_MESH_MIN_REPORTS ?? '3'),
  };
}

/** Laplace noise scaled by privacy budget ε (lower ε → more noise). */
export function applyDifferentialPrivacyNoise(value: number, epsilon: number): number {
  const scale = 1 / Math.max(epsilon, 0.01);
  const u = Math.random() - 0.5;
  const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  return value + noise;
}

export function hashFederatedSignature(payload: string): string {
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export function shouldShareFederatedDelta(params: {
  sampleCount: number;
  epsilon: number;
  minReports: number;
}): { share: boolean; privacyBudgetEpsilon: number; reason: string } {
  if (params.sampleCount < params.minReports) {
    return {
      share: false,
      privacyBudgetEpsilon: params.epsilon,
      reason: `Below minReports threshold (${params.sampleCount}/${params.minReports})`,
    };
  }
  return {
    share: true,
    privacyBudgetEpsilon: params.epsilon,
    reason: `minReports threshold met (${params.sampleCount}≥${params.minReports}); ε=${params.epsilon}`,
  };
}
