import type { LearnedRuleDef, LearnedRuleTarget } from "./learned-rules-types.js";
export type ValidateLearnedRuleOptions = {
    benignArgumentSamples?: string[];
    benignDescriptionSamples?: string[];
    /** Skip FP scan (tests only). */
    skipFalsePositiveCheck?: boolean;
};
export type ValidateLearnedRuleResult = {
    ok: boolean;
    errors: string[];
    fingerprint?: string;
};
export declare function computeLearnedRuleFingerprint(target: LearnedRuleTarget, regex: string): string;
/** Validate a learned rule before writing to the runtime overlay. */
export declare function validateLearnedRule(rule: Pick<LearnedRuleDef, "target" | "regex" | "probe" | "message" | "category">, opts?: ValidateLearnedRuleOptions): ValidateLearnedRuleResult;
//# sourceMappingURL=validate-learned-rule.d.ts.map