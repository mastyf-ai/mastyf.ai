export interface PolicyTestOptions {
    policy: string;
    tool: string;
    args: string;
    server?: string;
    blockingMode?: string;
}
export interface PolicyTestResult {
    action: string;
    rule: string;
    reason: string;
    mode: string;
}
export declare function runPolicyTest(opts: PolicyTestOptions): PolicyTestResult;
//# sourceMappingURL=policy-test.d.ts.map