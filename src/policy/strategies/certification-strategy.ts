/**
 * Block tool calls when server certification does not meet policy requirement.
 */
import type { PolicyStrategy } from './types.js';
import { getAgenticContainer, isAgenticEnabled } from '../../utils/agentic-container.js';

export type CertLevel = 'bronze' | 'silver' | 'gold' | 'platinum';

const LEVEL_RANK: Record<CertLevel, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
};

export function certLevelMeets(actual: CertLevel, required: CertLevel): boolean {
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

export function parseCertLevel(raw: unknown): CertLevel | null {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'bronze' || v === 'silver' || v === 'gold' || v === 'platinum') return v;
  return null;
}

export const certificationStrategy: PolicyStrategy = {
  name: 'require-certification',
  evaluate({ normalized }, deps) {
    const required = parseCertLevel(deps.config.policy.require_certification);
    if (!required || !isAgenticEnabled()) return null;

    const container = getAgenticContainer();
    if (!container?.certifier) return null;
    const cert = container?.certifier.getCertification(normalized.serverName);
    if (!cert || !cert.certified) {
      return {
        action: deps.resolveAction('block'),
        rule: 'require-certification',
        reason: `Server ${normalized.serverName} is not certified (required: ${required})`,
      };
    }

    if (!certLevelMeets(cert.level, required)) {
      return {
        action: deps.resolveAction('block'),
        rule: 'require-certification',
        reason: `Server ${normalized.serverName} certification ${cert.level} below required ${required}`,
      };
    }

    return null;
  },
};
