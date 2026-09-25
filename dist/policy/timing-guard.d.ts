import type { CallContext, PolicyDecision } from './policy-types.js';
export declare function isTimingGuardEnabled(): boolean;
/** Aggregate all pattern hits (no early exit). */
export declare function scanTimingProbePatterns(blob: string): {
    matched: boolean;
    ruleIds: string[];
};
/** Fingerprint for enumeration: collapse quoted strings and common usernames. */
export declare function enumerationFingerprint(blob: string): string;
export declare function resetTimingProbeCounters(): void;
export declare function evaluateTimingGuard(ctx: CallContext): PolicyDecision | null;
//# sourceMappingURL=timing-guard.d.ts.map