export type PolicyAction = 'enforce' | 'relax' | 'skip';
export interface BanditContext {
    serverType: string;
    hourOfDay: number;
    agentTier: string;
    ruleCategory: string;
}
export interface BanditDecision {
    action: PolicyAction;
    confidence: number;
    expectedReward: number;
    upperBound: number;
    exploration: boolean;
    armStats: {
        action: PolicyAction;
        pulls: number;
        meanReward: number;
        ucb: number;
    }[];
}
export declare class ContextualBanditPolicyTuner {
    private arms;
    private readonly alpha;
    private readonly contextDim;
    constructor();
    /** Encode context into a feature vector. */
    private encodeContext;
    /** Select the best action given context. */
    selectAction(ctx: BanditContext): BanditDecision;
    /** Update the bandit with a reward observation. */
    update(action: PolicyAction, ctx: BanditContext, reward: number): void;
    private hashString;
    private dot;
    private matVecMul;
    private cloneMatrix;
}
//# sourceMappingURL=contextual-bandit.d.ts.map