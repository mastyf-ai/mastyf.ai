/**
 * Red Team Attack Generator — uses evolutionary fuzzing and pattern mutation
 * to generate novel attack payloads for self-assessment.
 *
 * Takes the existing adversarial harness corpus and:
 *   1. Mutates payloads (character swaps, encoding tricks, Unicode homoglyphs)
 *   2. Generates novel combinations of known attack patterns
 *   3. A/B tests proposed policy changes against historical incidents
 */
export interface AttackPayload {
    /** Unique attack id */
    id: string;
    /** Attack category */
    category: 'shell_injection' | 'path_traversal' | 'sql_injection' | 'prompt_injection' | 'ssrf' | 'secret_exposure' | 'unicode_evasion' | 'encoding_bypass';
    /** The attack payload string */
    payload: string;
    /** Target tool argument */
    targetArg: string;
    /** Expected detection method */
    expectedDetection: 'regex' | 'semantic' | 'heuristic';
    /** Whether this payload was AI-generated (vs curated) */
    generated: boolean;
    /** Generation method */
    generationMethod?: string;
}
export interface RedTeamResult {
    /** Total attacks executed */
    totalAttacks: number;
    /** Attacks blocked */
    blocked: number;
    /** Attacks passed (potential policy gap) */
    passed: number;
    /** Attacks that caused errors */
    errors: number;
    /** Block rate (0-1) */
    blockRate: number;
    /** By category breakdown */
    byCategory: Record<string, {
        blocked: number;
        passed: number;
        total: number;
    }>;
    /** Specific attacks that bypassed defenses */
    bypasses: AttackPayload[];
    /** Recommendations */
    recommendations: string[];
    /** Policy A/B test results */
    abTestResults?: ABTestResult;
}
export interface ABTestResult {
    /** The proposed policy change */
    proposedChange: string;
    /** Attacks blocked with current policy */
    currentBlockCount: number;
    /** Attacks that would be blocked with new policy */
    proposedBlockCount: number;
    /** New attacks that would be blocked */
    newlyCovered: number;
    /** Current attacks that would no longer be blocked */
    regression: number;
    /** Recommendation */
    recommendation: 'apply' | 'review' | 'reject';
}
export declare class AttackGenerator {
    private baseAttacks;
    constructor();
    /**
     * Initialize the base attack corpus from known patterns.
     */
    private initBaseAttacks;
    /**
     * Generate mutated variants of base attacks using evolutionary fuzzing.
     */
    generateMutations(count?: number): AttackPayload[];
    /**
     * Generate novel combinations of known attack patterns.
     */
    generateCombinations(count?: number): AttackPayload[];
    /**
     * Generate all attack payloads for a full red team assessment.
     */
    generateAllAttacks(): AttackPayload[];
    /**
     * Mutate a single attack payload.
     */
    private mutate;
    /**
     * A/B test a proposed policy change against historical incidents.
     */
    abTestPolicy(proposedChange: string, attacks: AttackPayload[], currentBlockFn: (payload: string) => boolean, proposedBlockFn: (payload: string) => boolean): ABTestResult;
}
//# sourceMappingURL=attack-generator.d.ts.map