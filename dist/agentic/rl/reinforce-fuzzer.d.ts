export type MutationStrategy = 'case_obfuscation' | 'space_substitution' | 'char_doubling' | 'null_byte_injection' | 'url_encoding' | 'unicode_homoglyph';
export interface ReinforceDecision {
    selectedStrategy: MutationStrategy;
    probability: number;
    strategyProbabilities: {
        strategy: MutationStrategy;
        probability: number;
    }[];
    totalEpisodes: number;
    averageReward: number;
}
export declare class ReinforceFuzzerSelector {
    private weights;
    private strategyStats;
    private episodes;
    private totalEpisodes;
    private cumulativeReward;
    private alpha;
    constructor();
    /** Build state vector from strategy statistics. */
    private buildState;
    /** Select a mutation strategy using the current policy. */
    select(): ReinforceDecision;
    /** Observe the reward from the last selected strategy. */
    observe(reward: number): void;
    /** Get strategy performance statistics. */
    getStats(): {
        strategy: MutationStrategy;
        attempts: number;
        bypasses: number;
        bypassRate: number;
        weight: number[];
    }[];
}
//# sourceMappingURL=reinforce-fuzzer.d.ts.map