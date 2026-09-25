/**
 * Multi-layer encoding evasion detection — base64, hex, URL chains, and
 * mismatch between raw arguments and deobfuscated content.
 */
import type { CallContext, PolicyDecision } from './policy-types.js';
export declare function isEncodingGuardEnabled(): boolean;
export declare function scanEncodingEvasion(blob: string): {
    matched: boolean;
    reason: string;
};
export declare function evaluateEncodingGuard(ctx: CallContext): PolicyDecision | null;
//# sourceMappingURL=encoding-guard.d.ts.map