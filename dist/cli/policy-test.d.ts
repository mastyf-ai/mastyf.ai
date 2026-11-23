import type { PolicyTestOptions } from './policy-test-request.js';
export { policyTestRequest, type PolicyTestOptions } from './policy-test-request.js';
export interface PolicyTestResult {
    action: string;
    rule: string;
    reason: string;
    mode: string;
    /** Time spent deciding, excluding loading the policy file and building the engine. */
    elapsedMs?: number;
}
export declare function runPolicyTest(opts: PolicyTestOptions): PolicyTestResult;
/**
 * Check a tool result against the policy: the response gate the proxy runs on every answer a
 * server sends back (data-leak scanning, injected instructions, and semantic review when enabled).
 */
export declare function runPolicyResultTest(opts: PolicyTestOptions & {
    result: string;
}): Promise<PolicyTestResult>;
//# sourceMappingURL=policy-test.d.ts.map