/**
 * B3 — Federated delta privacy per THREAT_MESH_PRIVACY.md (ε-DP + threshold gating).
 */
import { createHash } from 'crypto';
export function federatedPrivacyConfig() {
    return {
        epsilon: Number(process.env.MASTYF_AI_FEDERATED_LEARNING_EPSILON ?? process.env.MASTYF_AI_THREAT_MESH_EPSILON ?? '1.0'),
        minReports: Number(process.env.MASTYF_AI_FEDERATED_LEARNING_MIN_REPORTS ?? process.env.MASTYF_AI_THREAT_MESH_MIN_REPORTS ?? '3'),
    };
}
/** Laplace noise scaled by privacy budget ε (lower ε → more noise). */
export function applyDifferentialPrivacyNoise(value, epsilon) {
    const scale = 1 / Math.max(epsilon, 0.01);
    const u = Math.random() - 0.5;
    const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    return value + noise;
}
export function hashFederatedSignature(payload) {
    return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}
export function shouldShareFederatedDelta(params) {
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
//# sourceMappingURL=federated-privacy.js.map