import crypto from 'node:crypto';

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

function hashSignature(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function buildMtxRecord(params: {
  toolName: string;
  argFingerprint: string;
  category: string;
  blockReason: string;
  reportCount?: number;
}): MtxRecordV1 {
  const argPatternHash = hashSignature(params.argFingerprint);
  const signatureHash = hashSignature(`${params.toolName}:${argPatternHash}:${params.category}`);
  const now = new Date().toISOString();
  return {
    mtxVersion: '1.0',
    signatureHash,
    toolPattern: params.toolName,
    argPatternHash,
    category: params.category,
    blockReason: params.blockReason.slice(0, 200),
    reportCount: params.reportCount ?? 1,
    firstSeen: now,
    lastSeen: now,
  };
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

const LOCAL_FEED_CACHE: Map<string, SyndicatedThreat[]> = new Map();
const SUBSCRIPTIONS: Map<string, FeedSubscription> = new Map();

export class ThreatFeedSyndicator {
  async subscribe(subscription: Omit<FeedSubscription, 'id' | 'addedCount' | 'createdAt'>): Promise<FeedSubscription> {
    const id = `feed_${crypto.randomBytes(8).toString('hex')}`;
    const sub: FeedSubscription = {
      ...subscription,
      id,
      addedCount: 0,
      createdAt: new Date().toISOString(),
    };
    SUBSCRIPTIONS.set(id, sub);
    return sub;
  }

  async syncFeed(subscriptionId: string): Promise<SyndicatedThreat[]> {
    const sub = SUBSCRIPTIONS.get(subscriptionId);
    if (!sub || !sub.enabled) return [];

    try {
      const res = await fetch(sub.feedUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        console.warn(`[threat-feed] Failed to sync feed "${sub.name}": HTTP ${res.status}`);
        return [];
      }

      const manifest = (await res.json()) as ThreatFeedManifest;
      if (!manifest.entries || !Array.isArray(manifest.entries)) {
        console.warn(`[threat-feed] Invalid manifest format from "${sub.name}"`);
        return [];
      }

      const cached = LOCAL_FEED_CACHE.get(sub.id) || [];
      const existingHashes = new Set(cached.map(e => e.signatureHash));

      const newThreats: SyndicatedThreat[] = [];
      for (const entry of manifest.entries) {
        if (!existingHashes.has(entry.signatureHash)) {
          newThreats.push({
            ...entry,
            sourceFeed: sub.name,
          });
        }
      }

      if (newThreats.length > 0) {
        LOCAL_FEED_CACHE.set(sub.id, [...cached, ...newThreats]);
        sub.lastSync = new Date().toISOString();
        sub.addedCount += newThreats.length;
        console.log(`[threat-feed] Synced ${newThreats.length} new threats from "${sub.name}"`);
      }

      return newThreats;
    } catch (err: any) {
      console.warn(`[threat-feed] Sync error for "${sub.name}": ${err.message}`);
      return [];
    }
  }

  async syncAllFeeds(tenantId: string): Promise<Map<string, SyndicatedThreat[]>> {
    const results = new Map<string, SyndicatedThreat[]>();
    for (const [, sub] of SUBSCRIPTIONS) {
      if (sub.tenantId === tenantId && sub.enabled) {
        const threats = await this.syncFeed(sub.id);
        if (threats.length > 0) {
          results.set(sub.id, threats);
        }
      }
    }
    return results;
  }

  getFeedThreats(subscriptionId: string): SyndicatedThreat[] {
    return LOCAL_FEED_CACHE.get(subscriptionId) || [];
  }

  getAllTenantThreats(tenantId: string): SyndicatedThreat[] {
    const allThreats: SyndicatedThreat[] = [];
    for (const [id, sub] of SUBSCRIPTIONS) {
      if (sub.tenantId === tenantId && sub.enabled) {
        allThreats.push(...this.getFeedThreats(id));
      }
    }
    return allThreats;
  }

  getSubscriptions(tenantId: string): FeedSubscription[] {
    return [...SUBSCRIPTIONS.values()].filter(s => s.tenantId === tenantId);
  }

  async removeSubscription(subscriptionId: string): Promise<boolean> {
    LOCAL_FEED_CACHE.delete(subscriptionId);
    return SUBSCRIPTIONS.delete(subscriptionId);
  }

  async publishLocalFeed(
    tenantId: string,
    feedMetadata: { name: string; description: string; maintainer: string },
  ): Promise<ThreatFeedManifest> {
    const threats = this.getAllTenantThreats(tenantId);
    const signatures = threats.map(t => t.signatureHash);

    return {
      feedId: `mastyf-feed-${tenantId}`,
      name: feedMetadata.name,
      version: 1,
      description: feedMetadata.description,
      maintainer: feedMetadata.maintainer,
      entries: threats,
      signatures,
      lastUpdated: new Date().toISOString(),
    };
  }

  exportThreatAsMtx(threat: SyndicatedThreat): MtxRecordV1 {
    return buildMtxRecord({
      toolName: threat.toolPattern,
      argFingerprint: threat.argPatternHash,
      category: threat.category,
      blockReason: threat.blockReason,
    });
  }
}

export const threatFeedSyndicator = new ThreatFeedSyndicator();
