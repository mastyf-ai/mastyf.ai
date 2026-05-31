/**
 * A3 — Policy strategy: block/warn on behavioral biometric anomalies.
 */
import type { PolicyStrategy } from './types.js';
import { getAgenticContainer, isAgenticEnabled } from '../../utils/agentic-container.js';

export const behavioralBiometricsStrategy: PolicyStrategy = {
  name: 'behavioral-biometrics',
  evaluate({ normalized, raw }, deps) {
    if (!isAgenticEnabled()) return null;
    const container = getAgenticContainer();
    const engine = container?.behaviorFingerprint;
    const agentId = raw.agentIdentity?.sub ?? String(raw.requestId);
    if (!engine || !agentId) return null;

    const argBytes = JSON.stringify(normalized.arguments ?? {}).length;
    const anomaly = engine.scoreAnomaly(agentId, {
      agentId,
      toolName: normalized.toolName,
      argBytes,
      credentialIdentity: raw.agentIdentity?.sub,
      timestamp: Date.now(),
    });

    if (anomaly.score > 0.25) {
      container.reputationEngine.recordBiometricSignal(
        agentId,
        anomaly.score,
        Boolean(raw.agentIdentity?.sub && anomaly.reason.includes('credential')),
      );
    }

    if (anomaly.blocked) {
      return {
        action: deps.resolveAction('block'),
        rule: 'behavioral-biometrics',
        reason: `Behavioral anomaly (${(anomaly.score * 100).toFixed(0)}%): ${anomaly.reason}`,
      };
    }
    return null;
  },
};
