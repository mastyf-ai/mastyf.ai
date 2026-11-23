export declare function extractPathArgumentValues(args: Record<string, unknown> | undefined): string[];
export interface PathGuardResult {
    block: boolean;
    reason?: string;
    /** The path as it appeared in the arguments. */
    match?: string;
}
/** Lowercase, slash-normalize, and collapse `..` segments for consistent matching. */
export declare function normalizePathForGuard(raw: string): string;
export declare function evaluatePathGuard(paths: string[]): PathGuardResult;
//# sourceMappingURL=path-guard.d.ts.map