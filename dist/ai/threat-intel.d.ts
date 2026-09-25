import { PolicyRule } from '../policy/policy-types.js';
export interface ThreatIntelEntry {
    id: string;
    source: 'OSV' | 'NVD' | 'GitHub' | 'custom';
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    affectedPackage?: string;
    affectedPattern?: string;
    signature?: string;
    description: string;
    remediation: string;
    publishedAt: string;
}
export interface ThreatSuggestion {
    rule: PolicyRule;
    confidence: number;
    reason: string;
    source: 'threat';
    entry: ThreatIntelEntry;
}
export type ThreatIntelCatalogEntry = ThreatIntelEntry & {
    firstSeenAt: string;
};
export type ThreatIntelSuppressedState = {
    action: 'removed' | 'quarantined';
    at: string;
    by?: string;
};
export type ThreatIntelQuarantineRecord = {
    id: string;
    source: ThreatIntelEntry['source'];
    severity: ThreatIntelEntry['severity'];
    description: string;
    remediation: string;
    publishedAt: string;
    affectedPackage?: string;
    affectedPattern?: string;
    signature?: string;
    quarantinedAt: string;
    operator?: string;
    note?: string;
    appliedRuleName?: string;
    policyPath?: string;
};
export interface ThreatIntelStatus {
    threats: number;
    knownIds: string[];
    entries: ThreatIntelCatalogEntry[];
    updated: string | null;
    lastPollAt: string | null;
    pollingActive: boolean;
    pollingDisabled: boolean;
    suppressed: number;
}
/** Shared ThreatIntel instance (proxy, dashboard, learning engine). */
export declare function getSharedThreatIntel(statePath?: string): ThreatIntel;
/** Start live NVD/OSV/GitHub polling unless explicitly disabled. */
export declare function startThreatIntelPollingIfEnabled(): ThreatIntel;
/**
 * Threat intelligence integration — ingests MCP-specific threat feeds and
 * auto-generates blocking policy rules based on severity and applicability.
 * Maintains a last-seen state to only process new entries on each fetch.
 */
export declare class ThreatIntel {
    private lastSeenIds;
    private knownEntries;
    private statePath;
    private pollTimer;
    private lastUpdated;
    private lastPollAt;
    private nvdApiKey;
    private suppressed;
    private quarantineArchive;
    constructor(statePath?: string);
    /** Start periodic polling of live threat feeds (NVD, OSV, GitHub) */
    startLivePolling(intervalMs?: number): void;
    /** Stop live polling */
    stopLivePolling(): void;
    /** Poll all live threat feed sources */
    pollLiveFeeds(): Promise<ThreatIntelEntry[]>;
    isPollingActive(): boolean;
    /** Dashboard / API snapshot of known threat feed IDs and metadata. */
    getStatus(): ThreatIntelStatus;
    /** Recent catalog entries for Threat Lab / learning cycle (severity filter optional). */
    getCatalogEntries(opts?: {
        minSeverity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
        limit?: number;
    }): ThreatIntelEntry[];
    dismissThreat(id: string, operator?: string, note?: string): {
        ok: boolean;
        error?: string;
        entry?: ThreatIntelCatalogEntry;
    };
    quarantineThreat(id: string, opts?: {
        operator?: string;
        note?: string;
        appliedRuleName?: string;
        policyPath?: string;
    }): {
        ok: boolean;
        error?: string;
        record?: ThreatIntelQuarantineRecord;
    };
    restoreThreat(id: string): {
        ok: boolean;
        error?: string;
    };
    listQuarantined(days?: number): ThreatIntelQuarantineRecord[];
    getEntryById(id: string): ThreatIntelCatalogEntry | null;
    /** Poll NVD API v2 for recent CVEs relevant to MCP ecosystem */
    private pollNvdFeed;
    /** Poll OSV.dev API for MCP ecosystem vulnerabilities */
    private pollOsvFeed;
    /** Poll GitHub Advisory Database for MCP-related advisories */
    private pollGitHubFeed;
    /** Load last-seen threat IDs from disk */
    private loadState;
    /** Persist last-seen threat IDs */
    private saveState;
    private rememberEntry;
    /** Fetch threat entries from a JSON feed file or in-memory array */
    fetchFeed(sourcePath: string): ThreatIntelEntry[];
    /** Diff new entries against last-seen state — returns only previously unseen */
    diffFeed(entries: ThreatIntelEntry[]): ThreatIntelEntry[];
    private purgeQuarantineArchive;
    /** Convert threat intel entries into policy rules */
    generateRules(entries: ThreatIntelEntry[], existingServerNames?: string[]): ThreatSuggestion[];
    private severityToConfidence;
    private severityToAction;
    /** Fetch + diff + generate in one call */
    processFeed(sourcePath: string, existingServerNames?: string[]): ThreatSuggestion[];
}
//# sourceMappingURL=threat-intel.d.ts.map