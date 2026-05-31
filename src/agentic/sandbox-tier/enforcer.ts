/**
 * Sandbox tier enforcer — shadow / redact / allow tiers for scoped agents or tools.
 */
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { Container } from '../../container.js';
import { Logger } from '../../utils/logger.js';

export type SandboxTier = 'shadow' | 'redact' | 'allow';

export interface SandboxScope {
  scopeType: 'agent' | 'tool' | 'server';
  scopeId: string;
}

export class SandboxTierEnforcer {
  private tiers = new Map<string, SandboxTier>();

  constructor(private readonly store?: IndustryStandardStore) {}

  private key(scope: SandboxScope): string {
    return `${scope.scopeType}:${scope.scopeId}`;
  }

  getTier(scope: SandboxScope): SandboxTier {
    const k = this.key(scope);
    const cached = this.tiers.get(k);
    if (cached) return cached;
    const persisted = this.store?.getSandboxTier(scope.scopeType, scope.scopeId);
    const tier = (persisted as SandboxTier | null) ?? 'allow';
    this.tiers.set(k, tier);
    return tier;
  }

  setTier(scope: SandboxScope, tier: SandboxTier): void {
    this.tiers.set(this.key(scope), tier);
    this.store?.upsertSandboxTier(scope.scopeType, scope.scopeId, tier);
  }

  shouldShadow(scope: SandboxScope): boolean {
    return this.getTier(scope) === 'shadow';
  }

  shouldRedact(scope: SandboxScope): boolean {
    const tier = this.getTier(scope);
    return tier === 'shadow' || tier === 'redact';
  }

  shouldAllow(scope: SandboxScope): boolean {
    return this.getTier(scope) === 'allow';
  }

  evaluate(scope: SandboxScope): { shadow: boolean; redact: boolean; allow: boolean; tier: SandboxTier } {
    const tier = this.getTier(scope);
    return {
      tier,
      shadow: tier === 'shadow',
      redact: tier === 'shadow' || tier === 'redact',
      allow: tier === 'allow',
    };
  }

  /** Apply RL + reputation signals to sandbox tiers (scheduled task). */
  syncFromReputationAndRl(container: Container): void {
    const servers = new Set<string>();
    for (const cert of container.certifier.listCertified()) {
      servers.add(cert.serverName);
    }

    for (const server of servers) {
      const scope = { scopeType: 'server' as const, scopeId: server };
      const cert = container.certifier.getCertification(server);
      if (!cert?.certified) {
        const defaultTier = (process.env.GUARDIAN_DEFAULT_SANDBOX_TIER || 'shadow') as SandboxTier;
        this.setTier(scope, defaultTier);
        continue;
      }

      const trust = container.thompsonSampling.sample(server);
      if (trust.sampledScore < 0.35) {
        this.setTier(scope, 'shadow');
      } else if (trust.sampledScore < 0.6) {
        this.setTier(scope, 'redact');
      } else {
        this.setTier(scope, 'allow');
      }
    }

    Logger.debug(`[Sandbox] RL/reputation tier sync complete (${servers.size} servers)`);
  }

  ensureDefaultTierForServer(serverName: string, certified: boolean): SandboxTier {
    if (certified) return this.getTier({ scopeType: 'server', scopeId: serverName });
    const envTier = process.env.GUARDIAN_DEFAULT_SANDBOX_TIER as SandboxTier | undefined;
    const tier: SandboxTier = envTier ?? 'shadow';
    const scope = { scopeType: 'server' as const, scopeId: serverName };
    if (this.getTier(scope) === 'allow') {
      this.setTier(scope, tier);
    }
    return this.getTier(scope);
  }
}
