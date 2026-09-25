import { Logger } from '../../utils/logger.js';
export function adjustSandboxTierForZeroTrust(enforcer, params) {
    const scope = { scopeType: 'server', scopeId: params.serverName };
    const previousTier = enforcer.getTier(scope);
    let newTier = previousTier;
    let adjusted = false;
    if (params.action === 'block' || params.composite < 0.35) {
        newTier = 'shadow';
    }
    else if (params.action === 'step_up' || params.composite < 0.55) {
        newTier = 'redact';
    }
    else if (params.composite >= 0.75 && previousTier !== 'allow') {
        newTier = 'allow';
    }
    if (newTier !== previousTier) {
        enforcer.setTier(scope, newTier);
        adjusted = true;
        Logger.info(`[ZeroTrust] Sandbox tier ${params.serverName}: ${previousTier} → ${newTier} (composite=${params.composite.toFixed(2)})`);
        if (params.agentId) {
            enforcer.setTier({ scopeType: 'agent', scopeId: params.agentId }, newTier);
        }
    }
    return { previousTier, newTier, adjusted };
}
//# sourceMappingURL=tier-adjuster.js.map