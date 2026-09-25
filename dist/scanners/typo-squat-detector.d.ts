import type { TypoSquatResult } from '../types.js';
/** Known malicious or deceptive packages (exact name match, case-insensitive). */
export declare const MALICIOUS_PACKAGE_WATCHLIST: readonly ["pino-sdk-v2"];
/**
 * Fetch live corpus from OSV.dev (free, no auth required).
 * Cached for 24 hours to avoid rate limits.
 */
export declare function fetchLiveCorpus(cacheDir: string): Promise<string[]>;
export declare class TypoSquatDetector {
    private trustedPackages;
    /** BK-tree index: term → canonical trusted package name (L-1). */
    private index;
    private termToPackage;
    constructor(trusted?: string[]);
    private buildIndex;
    detect(name: string): TypoSquatResult[];
}
//# sourceMappingURL=typo-squat-detector.d.ts.map