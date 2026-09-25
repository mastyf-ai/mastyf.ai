import { ProxyCallRecord } from '../types.js';
import { PolicyRule } from '../policy/policy-types.js';
export interface AttackPatternSuggestion {
    rule: PolicyRule;
    confidence: number;
    reason: string;
    source: 'attack';
}
export declare function attackMinBlocks(): number;
/** Minimum confidence before a learned pattern may be auto-applied (default requires human review). */
export declare function attackMinConfidence(): number;
export declare function attackGroupKey(blockRule: string, toolName: string): string;
/** Build one attack suggestion from a group of blocked records (same rule+tool). */
export declare function suggestFromBlockedGroup(blockRule: string, toolName: string, recs: ProxyCallRecord[]): AttackPatternSuggestion | null;
/**
 * Heuristic learner: repeated blocks on the same tool/rule → argPattern or deny rule suggestions.
 */
export declare function learnAttackPatterns(records: ProxyCallRecord[]): AttackPatternSuggestion[];
//# sourceMappingURL=attack-pattern-learner.d.ts.map