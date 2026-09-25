import { PolicyConfig, PolicyDecision, CallContext, PolicyMode } from './policy-types.js';
import { ShellTokenizer } from './shell-tokenizer.js';
/**
 * Policy Engine — evaluates every intercepted tools/call against configured rules.
 * Supports three modes: audit (passive), warn (flag only), block (active enforcement).
 *
 * v1.2: Integrated payload normalization and semantic shell analysis layers
 * v2.1: Replaced Map with LRUCache to prevent memory leaks under sustained load
 * v2.9: Strategy-pattern pipeline under src/policy/strategies/
 */
export declare class PolicyEngine {
    private rules;
    private mode;
    private config;
    private get callCounters();
    private get burstCounters();
    private normalizer;
    private shellTokenizer;
    private compiledPatterns;
    private compiledArgPatterns;
    private readonly policyEvalLock;
    private compiledRbacClientIds;
    constructor(config: PolicyConfig);
    private compilePatterns;
    private compileRbacClientIds;
    private extractLeafValues;
    /**
     * Anti-evasion token budget: use reported count and UTF-8 byte inflation from arguments.
     */
    private effectiveRequestTokens;
    private policyEvalLockKey;
    private buildDeps;
    isOpaEnabled(): boolean;
    evaluateAsync(context: CallContext): Promise<PolicyDecision>;
    /** Clear in-memory per-minute call counters (harness / isolated rate-limit suites). */
    resetRateCounters(): void;
    evaluate(context: CallContext, options?: {
        skipLocalRateLimit?: boolean;
        yamlOnly?: boolean;
        /** When false, caller applies async envelope (evaluateAsync). Default true. */
        applyTimingEnvelope?: boolean;
    }): PolicyDecision;
    private evaluateRule;
    private resolveAction;
    getMode(): PolicyMode;
    getRules(): ReadonlyArray<PolicyConfig['policy']['rules'][number]>;
    getRuleCount(): number;
    evaluateResponse(toolName: string, serverName: string, responseBody: string | null | undefined): {
        clean: boolean;
        detections: string[];
        hasCritical?: boolean;
        hasHigh?: boolean;
    };
    getShellTokenizer(): ShellTokenizer;
}
//# sourceMappingURL=policy-engine.d.ts.map