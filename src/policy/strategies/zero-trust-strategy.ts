/**
 * C3 — Policy strategy: zero-trust composite score gate.
 */
import type { PolicyStrategy } from './types.js';
import { getAgenticContainer, isAgenticEnabled } from '../../utils/agentic-container.js';
import { getActiveSpiffeId } from '../../utils/mtls-config.js';
import { adjustSandboxTierForZeroTrust } from '../../agentic/zero-trust/tier-adjuster.js';

export const zeroTrustStrategy: PolicyStrategy = {
  name: 'zero-trust-score',
  evaluate({ normalized, raw }, deps) {
    if (!isAgenticEnabled()) return null;
    const container = getAgenticContainer();
    const engine = container?.zeroTrustEngine;
    if (!engine) return null;

    const score = engine.score({
      agentId: raw.agentIdentity?.sub ?? String(raw.requestId),
      sessionId: String(raw.requestId),
      serverName: normalized.serverName,
      toolName: normalized.toolName,
      authenticated: Boolean(raw.agentIdentity),
      spiffeId: getActiveSpiffeId(),
      credentialIdentity: raw.agentIdentity?.sub,
      geoRegion: raw.geoRegion,
      hourUtc: raw.hourUtc,
      dataSensitivity: /read|list|search|get/i.test(normalized.toolName) ? 'medium' : 'low',
    });

    if (container?.sandboxEnforcer) {
      adjustSandboxTierForZeroTrust(container.sandboxEnforcer, {
        serverName: normalized.serverName,
        agentId: raw.agentIdentity?.sub,
        composite: score.composite,
        action: score.action,
      });
    }

    if (score.action === 'block' || score.action === 'step_up') {
      return {
        action: deps.resolveAction('block'),
        rule: 'zero-trust-score',
        reason: score.stepUpRequestId
          ? `${score.reason} (approval=${score.stepUpRequestId})`
          : `${score.reason} (composite=${score.composite.toFixed(2)})`,
      };
    }
    return null;
  },
};
