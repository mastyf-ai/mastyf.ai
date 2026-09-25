/**
 * C3 — Dynamic sandbox tier adjustment based on zero-trust composite score.
 */
import type { SandboxTierEnforcer, SandboxTier } from '../sandbox-tier/enforcer.js';
export declare function adjustSandboxTierForZeroTrust(enforcer: SandboxTierEnforcer, params: {
    serverName: string;
    agentId?: string;
    composite: number;
    action: 'allow' | 'step_up' | 'block';
}): {
    previousTier: SandboxTier;
    newTier: SandboxTier;
    adjusted: boolean;
};
//# sourceMappingURL=tier-adjuster.d.ts.map