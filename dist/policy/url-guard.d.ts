export declare function isDangerousUrl(raw: string): {
    block: boolean;
    reason?: string;
};
export declare function extractUrlArgumentValues(args: Record<string, unknown> | undefined, toolName?: string): string[];
export declare function extractHttpUrlsFromLeaves(obj: unknown): string[];
export interface UrlGuardResult {
    block: boolean;
    reason?: string;
}
export declare function evaluateUrlGuard(urls: string[], toolName?: string): UrlGuardResult;
//# sourceMappingURL=url-guard.d.ts.map