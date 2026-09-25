/**
 * Resource exhaustion guards — argument size, JSON depth, regex evaluation bounds.
 */
import type { CallContext, PolicyDecision } from './policy-types.js';
export declare function evaluateResourceGuard(ctx: CallContext, argsStr: string, rawArguments?: Record<string, unknown> | null): PolicyDecision | null;
//# sourceMappingURL=resource-guard.d.ts.map