interface MtxRecordV1 {
    mtxVersion: string;
    signatureHash: string;
    toolPattern: string;
    argPatternHash: string;
    category: string;
    blockReason: string;
    reportCount: number;
    firstSeen: string;
    lastSeen: string;
}
interface FeedSubscription {
    id: string;
    tenantId: string;
    name: string;
    feedUrl: string;
    enabled: boolean;
    lastSync?: string;
    addedCount: number;
    createdAt: string;
}
interface SyndicatedThreat {
    signatureHash: string;
    toolPattern: string;
    argPatternHash: string;
    category: string;
    blockReason: string;
    sourceFeed: string;
    firstSeen: string;
    lastSeen: string;
}
interface ThreatFeedManifest {
    feedId: string;
    name: string;
    version: number;
    description: string;
    maintainer: string;
    entries: SyndicatedThreat[];
    signatures: string[];
    lastUpdated: string;
}
export declare class ThreatFeedSyndicator {
    subscribe(subscription: Omit<FeedSubscription, 'id' | 'addedCount' | 'createdAt'>): Promise<FeedSubscription>;
    syncFeed(subscriptionId: string): Promise<SyndicatedThreat[]>;
    syncAllFeeds(tenantId: string): Promise<Map<string, SyndicatedThreat[]>>;
    getFeedThreats(subscriptionId: string): SyndicatedThreat[];
    getAllTenantThreats(tenantId: string): SyndicatedThreat[];
    getSubscriptions(tenantId: string): FeedSubscription[];
    removeSubscription(subscriptionId: string): Promise<boolean>;
    publishLocalFeed(tenantId: string, feedMetadata: {
        name: string;
        description: string;
        maintainer: string;
    }): Promise<ThreatFeedManifest>;
    exportThreatAsMtx(threat: SyndicatedThreat): MtxRecordV1;
}
export declare const threatFeedSyndicator: ThreatFeedSyndicator;
export {};
//# sourceMappingURL=threat-feed-syndicator.d.ts.map