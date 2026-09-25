/**
 * Per-session multi-call flow analysis — detects read-sensitive → exfil tool sequences.
 */
import type { CallContext, PolicyDecision } from './policy-types.js';
import { recordSensitiveResponseAccess, resetSessionFlowStore } from './session-flow-store.js';
export { recordSensitiveResponseAccess, resetSessionFlowStore as resetSessionFlowHistory };
export { evaluateLoopAnomalyGuard } from './loop-anomaly-detector.js';
export declare function flowSessionKey(ctx: CallContext): string;
/** Record a tool call for subsequent cross-call chain detection. */
export declare function recordSessionToolCall(ctx: CallContext): void;
/**
 * Block when a prior sensitive read or response DLP hit is followed by an exfil-capable tool call,
 * or when DIFC dynamic taint tracking detects cross-tool data propagation to an egress sink.
 */
export declare function evaluateSessionFlowGuard(ctx: CallContext): PolicyDecision | null;
//# sourceMappingURL=session-flow-guard.d.ts.map