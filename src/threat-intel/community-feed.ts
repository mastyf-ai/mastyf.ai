/**
 * Community Threat Feed Exchange Protocol
 *
 * Implements privacy-preserving threat intelligence synchronization.
 * Transmits ONLY cryptographically hashed (SHA-256) pattern signatures,
 * threat categories, and detection heuristics. Zero raw prompts or PII ever leave the client.
 */

import crypto from 'crypto';

export interface AnonymizedThreatSignal {
  signalId: string;
  signatureHash: string; // SHA-256 hash of normalized pattern
  threatCategory: string; // e.g. "privilege_escalation", "graphql_bomb", "ssrf"
  confidence: number;
  toolsTargeted: string[]; // Generic tool identifiers only (e.g. "write_file")
  firstSeen: string;
  reportCount: number;
}

export interface ThreatFeedSyncResult {
  publishedCount: number;
  newSignaturesReceived: number;
  syncedAt: string;
}

export class CommunityThreatFeed {
  private localSignatures = new Map<string, AnonymizedThreatSignal>();
  private readonly optIn: boolean;

  constructor(options?: { optIn?: boolean }) {
    this.optIn =
      options?.optIn ??
      (process.env.MASTYF_AI_COMMUNITY_FEED_OPT_IN === 'true');
  }

  /**
   * Hashes a raw pattern or payload into a privacy-preserving SHA-256 vector.
   */
  public hashSignature(pattern: string): string {
    return crypto.createHash('sha256').update(pattern.trim().toLowerCase()).digest('hex');
  }

  /**
   * Records a local threat detection into the queue for anonymized publication.
   */
  public recordThreat(params: {
    patternOrSnippet: string;
    threatCategory: string;
    toolName: string;
    confidence?: number;
  }): AnonymizedThreatSignal | null {
    if (!this.optIn) return null;

    const signatureHash = this.hashSignature(params.patternOrSnippet);
    const existing = this.localSignatures.get(signatureHash);

    if (existing) {
      existing.reportCount++;
      return existing;
    }

    const signal: AnonymizedThreatSignal = {
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
  public getPendingSignals(): AnonymizedThreatSignal[] {
    return Array.from(this.localSignatures.values());
  }

  public getSignatureCount(): number {
    return this.localSignatures.size;
  }
}

export const globalCommunityThreatFeed = new CommunityThreatFeed();
