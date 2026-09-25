/**
 * Documentation / schema URL hosts excluded from MCPG-R-020 exfiltration alerts.
 * Suffix matching: `github.com` allows `docs.github.com`, `api.github.com`, etc.
 */
/** @internal */
export declare function resetSafeUrlAllowlistCacheForTests(): void;
export declare function isSafeUrlHost(hostname: string, suffixes?: string[]): boolean;
export declare function extractHttpUrls(text: string): string[];
export declare function findUnsafeUrls(text: string): string[];
export declare function getSafeUrlSuffixes(): readonly string[];
//# sourceMappingURL=url-allowlist.d.ts.map