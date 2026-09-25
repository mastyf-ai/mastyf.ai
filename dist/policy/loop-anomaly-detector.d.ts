/**
 * Loop / perturbation evasion guard — semantic similarity + high-frequency anomaly detection.
 */
import type { CallContext, PolicyDecision } from './policy-types.js';
/** Jaccard similarity on token sets (robust to small perturbations). */
export declare function payloadSimilarity(a: string, b: string): number;
export declare function fingerprintArguments(args: Record<string, unknown> | undefined): string;
export declare function evaluateLoopAnomalyGuard(ctx: CallContext): PolicyDecision | null;
//# sourceMappingURL=loop-anomaly-detector.d.ts.map