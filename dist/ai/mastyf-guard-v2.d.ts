/**
 * Mastyf Guard 1.5B v2.1: Relational Argument-Intent Neural Auditor (AIA)
 *
 * Implements:
 * P(proposed action deviates from authorized intent and scope | T, theta, C, x)
 *
 * Evaluates the 4 Core Enterprise Invariants:
 * 1. Recipient / Destination Deviation (AuthorizedDestination != ProposedDestination)
 * 2. Scope Expansion (AuthorizedScope subset of ProposedScope)
 * 3. Privilege Overgrant (Privilege_proposed > Privilege_authorized)
 * 4. Secondary Side-Effects (PrimaryAction = authorized && SecondaryAction = unauthorized)
 *
 * Operational Verdicts: ALLOW | BLOCK | ESCALATE
 */
import type { ToolSecurityContext, MastyfGuardV2Prediction } from './mastyf-guard-v2-schema.js';
export declare class MastyfGuardV2Auditor {
    private threshold;
    constructor(threshold?: number);
    /**
     * Constructs the structured prompt format for Relational AIA fine-tuning.
     */
    static buildStructuredPrompt(ctx: ToolSecurityContext): string;
    /**
     * Evaluates the proposed tool call using relational argument-intent auditing.
     */
    evaluate(ctx: ToolSecurityContext): MastyfGuardV2Prediction;
}
//# sourceMappingURL=mastyf-guard-v2.d.ts.map