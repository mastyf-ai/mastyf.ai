/** Optional hook for semantic scan duration observability (wired from server metrics on bootstrap). */
export type SemanticDurationHook = (phase: string, durationMs: number, outcome: string) => void;
export declare function setSemanticScanDurationHook(hook: SemanticDurationHook | null): void;
export declare function reportSemanticScanDuration(phase: string, durationMs: number, outcome: string): void;
//# sourceMappingURL=semantic-duration-hook.d.ts.map