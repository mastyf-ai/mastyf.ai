import { Logger } from '../../utils/logger.js';
/**
 * The tier a server starts in. New servers forward with protection on; shadow, which forwards
 * nothing, is opt-in through MASTYF_AI_DEFAULT_SANDBOX_TIER.
 */
export function resolveDefaultSandboxTier(env = process.env) {
    const value = env.MASTYF_AI_DEFAULT_SANDBOX_TIER?.trim();
    if (!value)
        return 'allow';
    if (value === 'shadow' || value === 'redact' || value === 'allow')
        return value;
    // Someone asked for a tier and mistyped it, so take the strictest reading.
    Logger.warn(`[Sandbox] Unknown MASTYF_AI_DEFAULT_SANDBOX_TIER "${value}"; using shadow`);
    return 'shadow';
}
export class SandboxTierEnforcer {
    store;
    tiers = new Map();
    constructor(store) {
        this.store = store;
    }
    key(scope) {
        return `${scope.scopeType}:${scope.scopeId}`;
    }
    getTier(scope) {
        const k = this.key(scope);
        const cached = this.tiers.get(k);
        if (cached)
            return cached;
        const persisted = this.store?.getSandboxTier(scope.scopeType, scope.scopeId);
        const tier = persisted ?? 'allow';
        this.tiers.set(k, tier);
        return tier;
    }
    setTier(scope, tier) {
        this.tiers.set(this.key(scope), tier);
        this.store?.upsertSandboxTier(scope.scopeType, scope.scopeId, tier);
    }
    shouldShadow(scope) {
        return this.getTier(scope) === 'shadow';
    }
    shouldRedact(scope) {
        const tier = this.getTier(scope);
        return tier === 'shadow' || tier === 'redact';
    }
    shouldAllow(scope) {
        return this.getTier(scope) === 'allow';
    }
    evaluate(scope) {
        const tier = this.getTier(scope);
        return {
            tier,
            shadow: tier === 'shadow',
            redact: tier === 'shadow' || tier === 'redact',
            allow: tier === 'allow',
        };
    }
    /** Apply RL + reputation signals to sandbox tiers (scheduled task). */
    syncFromReputationAndRl(container) {
        const servers = new Set();
        for (const cert of container.certifier.listCertified()) {
            servers.add(cert.serverName);
        }
        for (const server of servers) {
            const scope = { scopeType: 'server', scopeId: server };
            const cert = container.certifier.getCertification(server);
            if (!cert?.certified) {
                // The default never loosens a tier something stricter has already set.
                if (this.getTier(scope) === 'allow')
                    this.setTier(scope, resolveDefaultSandboxTier());
                continue;
            }
            const trust = container.thompsonSampling.sample(server);
            if (trust.sampledScore < 0.35) {
                this.setTier(scope, 'shadow');
            }
            else if (trust.sampledScore < 0.6) {
                this.setTier(scope, 'redact');
            }
            else {
                this.setTier(scope, 'allow');
            }
        }
        Logger.debug(`[Sandbox] RL/reputation tier sync complete (${servers.size} servers)`);
    }
    ensureDefaultTierForServer(serverName, certified) {
        if (certified)
            return this.getTier({ scopeType: 'server', scopeId: serverName });
        const tier = resolveDefaultSandboxTier();
        const scope = { scopeType: 'server', scopeId: serverName };
        if (this.getTier(scope) === 'allow') {
            this.setTier(scope, tier);
        }
        return this.getTier(scope);
    }
}
//# sourceMappingURL=enforcer.js.map