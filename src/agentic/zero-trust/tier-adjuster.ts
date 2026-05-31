/**
 * C3 — Dynamic sandbox tier adjustment based on zero-trust composite score.
 */
import type { SandboxTierEnforcer, SandboxTier } from '../sandbox-tier/enforcer.js';
import { Logger } from '../../utils/logger.js';

export function adjustSandboxTierForZeroTrust(
  enforcer: SandboxTierEnforcer,
  params: {
    serverName: string;
    agentId?: string;
    composite: number;
    action: 'allow' | 'step_up' | 'block';
  },
): { previousTier: SandboxTier; newTier: SandboxTier; adjusted: boolean } {
  const scope = { scopeType: 'server' as const, scopeId: params.serverName };
  const previousTier = enforcer.getTier(scope);
  let newTier: SandboxTier = previousTier;
  let adjusted = false;

  if (params.action === 'block' || params.composite < 0.35) {
    newTier = 'shadow';
  } else if (params.action === 'step_up' || params.composite < 0.55) {
    newTier = 'redact';
  } else if (params.composite >= 0.75 && previousTier !== 'allow') {
    newTier = 'allow';
  }

  if (newTier !== previousTier) {
    enforcer.setTier(scope, newTier);
    adjusted = true;
    Logger.info(
      `[ZeroTrust] Sandbox tier ${params.serverName}: ${previousTier} → ${newTier} (composite=${params.composite.toFixed(2)})`,
    );
    if (params.agentId) {
      enforcer.setTier({ scopeType: 'agent', scopeId: params.agentId }, newTier);
    }
  }

  return { previousTier, newTier, adjusted };
}
