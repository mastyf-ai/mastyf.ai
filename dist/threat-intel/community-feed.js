/**
 * Community Threat Feed Exchange Protocol
 *
 * Implements privacy-preserving threat intelligence synchronization.
 * Transmits ONLY cryptographically hashed (SHA-256) pattern signatures,
 * threat categories, and detection heuristics. Zero raw prompts or PII ever leave the client.
 */
import crypto from 'crypto';
export class CommunityThreatFeed {
    localSignatures = new Map();
    optIn;
    constructor(options) {
        this.optIn =
            options?.optIn ??
                (process.env.MASTYF_AI_COMMUNITY_FEED_OPT_IN === 'true');
    }
    /**
     * Hashes a raw pattern or payload into a privacy-preserving SHA-256 vector.
     */
    hashSignature(pattern) {
        return crypto.createHash('sha256').update(pattern.trim().toLowerCase()).digest('hex');
    }
    /**
     * Records a local threat detection into the queue for anonymized publication.
     */
    recordThreat(params) {
        if (!this.optIn)
            return null;
        const signatureHash = this.hashSignature(params.patternOrSnippet);
        const existing = this.localSignatures.get(signatureHash);
        if (existing) {
            existing.reportCount++;
            return existing;
        }
        const signal = {
            signalId: `sig_${signatureHash.slice(0, 12)}`,
            signatureHash,
            threatCategory: params.threatCategory,
            confidence: params.confidence ?? 0.90,
            toolsTargeted: [params.toolName],
            firstSeen: new Date().toISOString(),
            reportCount: 1,
        };
        this.localSignatures.set(signatureHash, signal);
        return signal;
    }
    /**
     * Retrieves pending signals formatted for anonymized exchange.
     */
    getPendingSignals() {
        return Array.from(this.localSignatures.values());
    }
    getSignatureCount() {
        return this.localSignatures.size;
    }
}
export const globalCommunityThreatFeed = new CommunityThreatFeed();
//# sourceMappingURL=community-feed.js.map