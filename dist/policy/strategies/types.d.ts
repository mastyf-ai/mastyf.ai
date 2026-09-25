import type { PolicyConfig, PolicyDecision, CallContext } from '../policy-types.js';
import type { ShellTokenizer } from '../shell-tokenizer.js';
import { getNormalizer } from '../../utils/payload-normalizer.js';
export interface PolicyEngineDeps {
    config: PolicyConfig;
    rules: PolicyConfig['policy']['rules'];
    mode: PolicyConfig['policy']['mode'];
    normalizer: ReturnType<typeof getNormalizer>;
    shellTokenizer: ShellTokenizer;
    compiledPatterns: Map<string, {
        compiled: RegExp[];
        rule: PolicyConfig['policy']['rules'][number];
    }[]>;
    compiledArgPatterns: Map<string, {
        field: string;
        compiled: RegExp[];
        rule: PolicyConfig['policy']['rules'][number];
    }[]>;
    callCounters: import('lru-cache').LRUCache<string, {
        count: number;
        resetAt: number;
    }>;
    resolveAction: (ruleAction: import('../policy-types.js').PolicyAction) => import('../policy-types.js').PolicyAction;
    extractLeafValues: (obj: unknown) => string[];
    evaluateRule: (rule: PolicyConfig['policy']['rules'][number], ctx: CallContext, analysis: {
        argsStr: string;
        raw?: CallContext;
    }, skipLocalRateLimit?: boolean) => PolicyDecision | null;
}
export interface SyncEvaluateContext {
    raw: CallContext;
    normalized: CallContext;
    argsStr: string;
    skipLocalRateLimit?: boolean;
}
export interface PolicyStrategy {
    readonly name: string;
    evaluate(ctx: SyncEvaluateContext, deps: PolicyEngineDeps): PolicyDecision | null;
}
export interface AsyncPolicyStrategy {
    readonly name: string;
    evaluateAsync(context: CallContext, deps: PolicyEngineDeps): Promise<PolicyDecision | null>;
}
//# sourceMappingURL=types.d.ts.map