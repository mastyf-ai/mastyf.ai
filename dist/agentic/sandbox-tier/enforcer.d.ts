/**
 * Sandbox tier enforcer — shadow / redact / allow tiers for scoped agents or tools.
 */
import { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { Container } from '../../container.js';
export type SandboxTier = 'shadow' | 'redact' | 'allow';
export interface SandboxScope {
    scopeType: 'agent' | 'tool' | 'server';
    scopeId: string;
}
export declare class SandboxTierEnforcer {
    private readonly store?;
    private tiers;
    constructor(store?: IndustryStandardStore | undefined);
    private key;
    getTier(scope: SandboxScope): SandboxTier;
    setTier(scope: SandboxScope, tier: SandboxTier): void;
    shouldShadow(scope: SandboxScope): boolean;
    shouldRedact(scope: SandboxScope): boolean;
    shouldAllow(scope: SandboxScope): boolean;
    evaluate(scope: SandboxScope): {
        shadow: boolean;
        redact: boolean;
        allow: boolean;
        tier: SandboxTier;
    };
    /** Apply RL + reputation signals to sandbox tiers (scheduled task). */
    syncFromReputationAndRl(container: Container): void;
    ensureDefaultTierForServer(serverName: string, certified: boolean): SandboxTier;
}
//# sourceMappingURL=enforcer.d.ts.map