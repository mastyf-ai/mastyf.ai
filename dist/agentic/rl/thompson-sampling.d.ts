export interface ThompsonTrustDecision {
    agentId: string;
    sampledScore: number;
    meanScore: number;
    uncertainty: number;
    tier: 'trusted' | 'standard' | 'suspicious' | 'blocked';
    exploration: boolean;
}
export declare class ThompsonSamplingAgentTrust {
    private agents;
    /** Record a tool call outcome for an agent. */
    record(agentId: string, outcome: 'safe' | 'blocked' | 'bypass'): void;
    /** Run Thompson Sampling — sample from each agent's Beta posterior. */
    sample(agentId: string): ThompsonTrustDecision;
    /** Get the current belief about an agent (without sampling). */
    getBelief(agentId: string): {
        mean: number;
        alpha: number;
        beta: number;
        confidence: number;
    };
    /** List all agents with their current belief state. */
    getAllBeliefs(): {
        agentId: string;
        mean: number;
        alpha: number;
        beta: number;
    }[];
    /** Gamma sample using Marsaglia-Tsang method. */
    private gammaSample;
    /** Approximate Gamma CDF for small shapes. */
    private gammaCDF;
    /** Box-Muller normal sample. */
    private normalSample;
}
//# sourceMappingURL=thompson-sampling.d.ts.map