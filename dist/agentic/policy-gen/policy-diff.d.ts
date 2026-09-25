/**
 * Policy Diff — compares generated policy against existing policy,
 * producing a human-readable diff with confidence-scored recommendations.
 */
import type { SynthesizedPolicy } from './policy-synthesizer.js';
export interface PolicyDiffResult {
    /** Rules present in generated but not in existing */
    additions: DiffEntry[];
    /** Rules present in existing but not in generated */
    removals: DiffEntry[];
    /** Rules with different configurations between the two */
    modifications: DiffEntry[];
    /** Overall similarity score 0-1 (1 = identical) */
    similarityScore: number;
    /** Human-readable summary */
    summary: string;
}
export interface DiffEntry {
    ruleType: string;
    description: string;
    generatedValue: string;
    existingValue?: string;
    confidence: number;
    recommendation: string;
}
export declare class PolicyDiff {
    /**
     * Compare a synthesized/generated policy against an existing policy YAML string.
     */
    diff(generated: SynthesizedPolicy, existingYaml: string | null): PolicyDiffResult;
    /** Extract tool names referenced in a YAML policy string. */
    private extractToolNames;
    /**
     * Generate a human-readable markdown diff report.
     */
    toMarkdown(diff: PolicyDiffResult): string;
}
//# sourceMappingURL=policy-diff.d.ts.map