import type { CallContext, PolicyDecision } from '../policy-types.js';
import type { PolicyMode } from '../policy-types.js';
/** Block duplicate idempotency keys within TTL (block mode only). */
export declare function evaluateIdempotency(context: CallContext, mode: PolicyMode): Promise<PolicyDecision | null>;
//# sourceMappingURL=idempotency-strategy.d.ts.map