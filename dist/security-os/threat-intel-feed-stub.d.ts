/**
 * Optional third-party threat intel feed stub (OS6).
 * Labeled third-party. Fail-closed when unavailable — never invent hits.
 */
export type ThreatIntelFeedStatus = 'DISABLED' | 'UNAVAILABLE' | 'EMPTY' | 'OK';
export interface ThreatIntelLookupResult {
    status: ThreatIntelFeedStatus;
    source_label: 'third-party';
    package_id: string;
    matched: boolean;
    reason: string;
    signals: never[];
}
export interface ThreatIntelFeedConfig {
    enabled: boolean;
    feedUrl?: string | null;
}
/**
 * Stub lookup: if disabled → DISABLED; if enabled but no reachable feed → UNAVAILABLE (fail-closed).
 * Does not call network in this stub — returns UNAVAILABLE when enabled so callers cannot treat silence as clean.
 */
export declare function lookupPoisonedPackageStub(packageId: string, config: ThreatIntelFeedConfig): ThreatIntelLookupResult;
//# sourceMappingURL=threat-intel-feed-stub.d.ts.map