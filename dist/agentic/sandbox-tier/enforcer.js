import { Logger } from '../../utils/logger.js';
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
                const defaultTier = (process.env.MASTYF_AI_DEFAULT_SANDBOX_TIER || 'shadow');
                this.setTier(scope, defaultTier);
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
        const scope = { scopeType: 'server', scopeId: serverName };
        const force = process.env.MASTYF_AI_SANDBOX_TIER_FORCE;
        if (force === 'shadow' || force === 'redact' || force === 'allow') {
            this.setTier(scope, force);
            return force;
        }
        if (certified)
            return this.getTier(scope);
        const envTier = process.env.MASTYF_AI_DEFAULT_SANDBOX_TIER;
        const tier = envTier ?? 'shadow';
        if (this.getTier(scope) === 'allow') {
            this.setTier(scope, tier);
        }
        return this.getTier(scope);
    }
}
//# sourceMappingURL=enforcer.js.map