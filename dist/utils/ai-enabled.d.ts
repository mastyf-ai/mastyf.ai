/**
 * AI learning & suggestion engine feature flags (enterprise defaults).
 *
 * Learning is ON unless MASTYF_AI_AI_ENABLED=false.
 * Auto-apply of generated rules is OFF unless MASTYF_AI_AI_AUTO_APPLY=true.
 */
export declare function isAiLearningEnabled(): boolean;
export declare function isAiAutoApplyEnabled(): boolean;
/** @deprecated Use isAiLearningEnabled */
export declare function isExperimentalAiEnabled(): boolean;
/** Learning on scan/audit/health CLI is opt-in (proxy/report hooks still respect MASTYF_AI_AI_ENABLED). */
export declare function isAiLearningOnCliCommands(): boolean;
//# sourceMappingURL=ai-enabled.d.ts.map