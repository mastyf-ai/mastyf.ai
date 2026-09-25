/**
 * Promote Threat Lab discoveries into @mastyf_ai/core runtime learned-rules overlay.
 */
import { type LearnedRuleTarget } from '@mastyf_ai/core';
import type { ThreatLabDiscovery } from './threat-lab.js';
export type CoreRulePromoteProvenance = {
    source: string;
    inputFingerprint: string;
    confidence: number;
};
export type CoreRulePromoteResult = {
    ok: boolean;
    status: 'promoted' | 'pending' | 'rejected' | 'skipped';
    reason?: string;
    ruleId?: string;
};
export declare function learnedRulesMinConfidence(): number;
export declare function classifyLearnedRuleTarget(discovery: ThreatLabDiscovery, source: string): LearnedRuleTarget;
/** Promote a validated Threat Lab discovery into the core learned-rules overlay. */
export declare function promoteDiscoveryToCoreRules(discovery: ThreatLabDiscovery, provenance: CoreRulePromoteProvenance): CoreRulePromoteResult;
//# sourceMappingURL=core-rule-promoter.d.ts.map