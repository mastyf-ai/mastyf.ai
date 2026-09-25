export interface ThresholdState {
    blockRate: number;
    fpRate: number;
    callVolume: number;
}
export type ThresholdAction = 'increase' | 'decrease' | 'maintain';
export interface SarsaDecision {
    parameter: 'rateLimit' | 'latencyLimit' | 'confidence';
    action: ThresholdAction;
    newValue: number;
    qValues: {
        action: ThresholdAction;
        value: number;
    }[];
    epsilon: number;
}
export declare class SarsaThresholdAdapter {
    private qTable;
    private rateLimit;
    private latencyLimit;
    private confidenceMin;
    private epsilon;
    private alpha;
    private gamma;
    private steps;
    /** Recommend an action for a specific threshold parameter. */
    decide(parameter: 'rateLimit' | 'latencyLimit' | 'confidence', state: ThresholdState): SarsaDecision;
    /** Learn from the outcome (SARSA update). */
    learn(parameter: 'rateLimit' | 'latencyLimit' | 'confidence', state: ThresholdState, action: ThresholdAction, reward: number, nextState: ThresholdState, nextAction: ThresholdAction): void;
    /** Get current threshold values. */
    getThresholds(): {
        rateLimit: number;
        latencyLimit: number;
        confidenceMin: number;
    };
    private hashState;
}
//# sourceMappingURL=sarsa-thresholds.d.ts.map