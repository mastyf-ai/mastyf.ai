import type { CallContext, PolicyDecision } from './policy-types.js';
/** Reset cached patterns (tests). */
export declare function resetThreatIntelGuardCache(): void;
/** Block tool calls whose arguments match live or baseline threat-intel signatures. */
export declare function evaluateThreatIntelGuard(ctx: CallContext): PolicyDecision | null;
//# sourceMappingURL=threat-intel-guard.d.ts.map