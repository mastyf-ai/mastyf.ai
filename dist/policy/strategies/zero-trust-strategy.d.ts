/**
 * C3 — Policy strategy: zero-trust composite score gate.
 */
import type { PolicyStrategy } from './types.js';
import type { CallContext } from '../policy-types.js';
/** Only a local stdio client with no identity has nobody to ask. Anything else fails closed. */
export declare function stepUpPossibleFor(raw: Pick<CallContext, 'agentIdentity' | 'localStdio'>): boolean;
export declare const zeroTrustStrategy: PolicyStrategy;
//# sourceMappingURL=zero-trust-strategy.d.ts.map