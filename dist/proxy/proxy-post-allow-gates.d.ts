import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
import type { PostPolicyGateBlock } from './proxy-post-policy-gates.js';
export type { PostPolicyGateBlock };
export type PostPolicyAllowGateOutcome = PostPolicyGateBlock | {
    allowed: true;
    spendReservationId?: string;
};
export declare function isPostPolicyGateBlock(outcome: PostPolicyAllowGateOutcome | null | undefined): outcome is PostPolicyGateBlock;
export declare function runPostPolicyAllowGates(context: CallContext, decision: PolicyDecision, serverName: string): Promise<PostPolicyAllowGateOutcome | null>;
//# sourceMappingURL=proxy-post-allow-gates.d.ts.map