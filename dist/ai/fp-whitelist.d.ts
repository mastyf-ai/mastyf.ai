export interface FpConfirmation {
    userId: string;
    ts: string;
}
export interface FpWhitelistEntry {
    rule: string;
    pattern: string;
    fingerprint: string;
    confirmedAt: string;
    confirmCount: number;
}
export interface FpWhitelistFile {
    version: 1;
    entries: FpWhitelistEntry[];
}
export declare function fpFingerprint(rule: string, pattern: string): string;
/**
 * Record a false-positive rejection from TUI/dashboard.
 * After threshold confirmations from distinct labelers, persists whitelist entry.
 */
export declare function recordFpRejection(rule: string, pattern: string, opts?: {
    userId?: string;
}): {
    fingerprint: string;
    confirmCount: number;
    whitelisted: boolean;
    blocked?: boolean;
    reason?: string;
};
export declare function isFpWhitelisted(rule: string, pattern: string): boolean;
export declare function listFpWhitelist(): FpWhitelistEntry[];
export declare function clearFpWhitelistForTests(): void;
//# sourceMappingURL=fp-whitelist.d.ts.map