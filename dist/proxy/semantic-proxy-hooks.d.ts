import type { CallContext, PolicyDecision } from '../policy/policy-types.js';
import { type PostPolicyGateBlock } from './proxy-post-policy-gates.js';
export declare function checkSemanticStrictPrecheck(context: CallContext, serverName: string): PostPolicyGateBlock | null;
/** Run strict pre-check, sync semantic gate, then enqueue async audit. Returns block info or null. */
export declare function runSemanticPipelineAfterPolicyAllow(context: CallContext, decision: PolicyDecision, serverName: string): Promise<PostPolicyGateBlock | null>;
//# sourceMappingURL=semantic-proxy-hooks.d.ts.map