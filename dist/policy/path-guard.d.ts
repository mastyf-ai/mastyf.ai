export declare function extractPathArgumentValues(args: Record<string, unknown> | undefined): string[];
export interface PathGuardResult {
    block: boolean;
    reason?: string;
}
/** Lowercase, slash-normalize, and collapse `..` segments for consistent matching. */
export declare function normalizePathForGuard(raw: string): string;
export declare function evaluatePathGuard(paths: string[]): PathGuardResult;
//# sourceMappingURL=path-guard.d.ts.map