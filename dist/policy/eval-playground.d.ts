export interface EvalPayload {
    tool: string;
    server?: string;
    args: Record<string, unknown>;
    expectedAction: 'block' | 'pass' | 'flag';
    category: string;
    description: string;
}
export interface EvalResult {
    payload: EvalPayload;
    actualAction: 'block' | 'pass' | 'flag';
    matched: boolean;
    matchedRule: string;
    matchedReason: string;
    durationMs: number;
}
export declare const CORPUS_EVAL_PAYLOADS: EvalPayload[];
export declare function runPolicyEval(payloads: EvalPayload[], evalFn: (payload: EvalPayload) => Promise<{
    action: string;
    rule: string;
    reason: string;
}>): Promise<EvalResult[]>;
export declare function computeEvalStats(results: EvalResult[]): {
    total: number;
    correct: number;
    incorrect: number;
    accuracy: number;
    truePositives: number;
    trueNegatives: number;
    falsePositives: number;
    falseNegatives: number;
    missedCritical: number;
    byCategory: Map<string, {
        total: number;
        correct: number;
    }>;
};
//# sourceMappingURL=eval-playground.d.ts.map