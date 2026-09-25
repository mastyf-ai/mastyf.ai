import type { LearnedRuleDef, LearnedRuleTarget } from "./learned-rules-types.js";
import type { ValidateLearnedRuleOptions } from "./validate-learned-rule.js";
export declare class LearnedRulesSignatureError extends Error {
    constructor(message: string);
}
/** Register cache bust hook from local-semantic-fallback (avoids circular import). */
export declare function registerLocalSemanticCacheBust(fn: () => void): void;
/** Load overlay rules from disk into memory (no-op when disabled). */
export declare function reloadLearnedRules(): LearnedRuleDef[];
/** In-memory learned rules (after reload). */
export declare function listLearnedRules(target?: LearnedRuleTarget): LearnedRuleDef[];
export declare function getLearnedRulesStats(): {
    enabled: boolean;
    total: number;
    argument: number;
    localSemantic: number;
};
export type AppendLearnedRuleResult = {
    ok: true;
    rule: LearnedRuleDef;
} | {
    ok: false;
    reason: string;
};
/** Append a validated rule to the overlay file. */
export declare function appendLearnedRule(draft: Omit<LearnedRuleDef, "id"> & {
    id?: string;
}, validateOpts?: ValidateLearnedRuleOptions): AppendLearnedRuleResult;
/** Start periodic overlay reload; returns stop function. */
export declare function startLearnedRulesReloadTimer(): () => void;
export declare function stopLearnedRulesReloadTimer(): void;
/** @internal */
export declare function resetLearnedRulesForTests(): void;
/** @internal */
export declare function setLearnedRulesPathForTests(path: string | null): void;
/** @internal */
export declare function writeLearnedRulesFileForTests(rules: LearnedRuleDef[]): void;
//# sourceMappingURL=learned-rules-store.d.ts.map