/**
 * Community Threat Feed Exchange Protocol
 *
 * Implements privacy-preserving threat intelligence synchronization.
 * Transmits ONLY cryptographically hashed (SHA-256) pattern signatures,
 * threat categories, and detection heuristics. Zero raw prompts or PII ever leave the client.
 */
export interface AnonymizedThreatSignal {
    signalId: string;
    signatureHash: string;
    threatCategory: string;
    confidence: number;
    toolsTargeted: string[];
    firstSeen: string;
    reportCount: number;
}
export interface ThreatFeedSyncResult {
    publishedCount: number;
    newSignaturesReceived: number;
    syncedAt: string;
}
export declare class CommunityThreatFeed {
    private localSignatures;
    private readonly optIn;
    constructor(options?: {
        optIn?: boolean;
    });
    /**
     * Hashes a raw pattern or payload into a privacy-preserving SHA-256 vector.
     */
    hashSignature(pattern: string): string;
    /**
     * Records a local threat detection into the queue for anonymized publication.
     */
    recordThreat(params: {
        patternOrSnippet: string;
        threatCategory: string;
        toolName: string;
        confidence?: number;
    }): AnonymizedThreatSignal | null;
    /**
     * Retrieves pending signals formatted for anonymized exchange.
     */
    getPendingSignals(): AnonymizedThreatSignal[];
    getSignatureCount(): number;
}
export declare const globalCommunityThreatFeed: CommunityThreatFeed;
//# sourceMappingURL=community-feed.d.ts.map