/**
 * B1 — Decentralized MCP Reputation Network (local + cloud sync).
 */
import { createHash } from 'crypto';
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { GuardianScore } from '../trust-score/guardian-score.js';
import { signReputationAttestation, verifyReputationAttestation } from './reputation-attestation.js';
import {
  computeTransitiveTrust,
  loadTrustEdgesFromStore,
  resolveTrustAnchor,
} from './reputation-web-of-trust.js';
import { mergeRatingsWithQuorum } from './reputation-quorum.js';

export type ReputationDimension =
  | 'security_posture'
  | 'auth_strength'
  | 'cve_hygiene'
  | 'publisher_trust'
  | 'policy_compliance'
  | 'uptime'
  | 'community_rating'
  | 'guardian_protected';

export interface ReputationDimensions {
  security_posture: number;
  auth_strength: number;
  cve_hygiene: number;
  publisher_trust: number;
  policy_compliance: number;
  uptime: number;
  community_rating: number;
  guardian_protected: number;
}

export interface ReputationEntry {
  serverHash: string;
  dimensions: ReputationDimensions;
  consensusScore: number;
  raterCount: number;
  level: 'bronze' | 'silver' | 'gold' | 'platinum';
  updatedAt: string;
  attestationJws?: string;
}

function hashServer(serverName: string, packageName?: string): string {
  return createHash('sha256').update(`${serverName}:${packageName ?? ''}`).digest('hex').slice(0, 32);
}

function levelFromScore(score: number): ReputationEntry['level'] {
  if (score >= 85) return 'platinum';
  if (score >= 70) return 'gold';
  if (score >= 50) return 'silver';
  return 'bronze';
}

export class ReputationNetwork {
  private entries = new Map<string, ReputationEntry>();

  constructor(
    private readonly store?: IndustryStandardStore,
    private readonly guardianScore?: GuardianScore,
  ) {}

  rateServer(params: {
    serverName: string;
    packageName?: string;
    dimensions: Partial<ReputationDimensions>;
    raterWeight?: number;
    raterId?: string;
  }): ReputationEntry {
    const serverHash = hashServer(params.serverName, params.packageName);
    const existing = this.entries.get(serverHash) ?? this.store?.getReputationEntry?.(serverHash);
    const raterId = params.raterId ?? process.env.GUARDIAN_TENANT_ID ?? 'local-rater';
    const raterTrust = this.store?.getRaterTrust?.(raterId).trustScore ?? 1.0;
    const raterWeight = (params.raterWeight ?? 1) * raterTrust;

    const defaults: ReputationDimensions = {
      security_posture: 50,
      auth_strength: 50,
      cve_hygiene: 50,
      publisher_trust: 50,
      policy_compliance: 50,
      uptime: 50,
      community_rating: 50,
      guardian_protected: existing ? 0 : 100,
    };

    const merged: ReputationDimensions = { ...defaults, ...(existing?.dimensions ?? {}), ...params.dimensions };
    const values = Object.values(merged);
    const weightedScore = existing
      ? Math.round(
          (existing.consensusScore * (existing.raterCount ?? 1) + (values.reduce((a, b) => a + b, 0) / values.length) * raterWeight)
          / ((existing.raterCount ?? 1) + raterWeight),
        )
      : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
    const raterCount = (existing?.raterCount ?? 0) + raterWeight;

    const attestationJws = signReputationAttestation({
      serverName: params.serverName,
      packageName: params.packageName,
      dimensions: merged,
      raterId,
      raterWeight,
      issuedAt: new Date().toISOString(),
    });

    this.store?.saveReputationRaterVote?.({
      serverHash,
      raterId,
      dimensions: params.dimensions as Record<string, number>,
      raterWeight,
      attestationJws,
    });

    let entry: ReputationEntry = {
      serverHash,
      dimensions: merged,
      consensusScore: weightedScore,
      raterCount,
      level: levelFromScore(weightedScore),
      updatedAt: new Date().toISOString(),
      attestationJws,
    };

    entry = this.applyByzantineQuorum(serverHash, entry);
    this.entries.set(serverHash, entry);
    this.store?.saveReputationEntry?.({
      serverHash: entry.serverHash,
      dimensions: entry.dimensions as unknown as Record<string, number>,
      consensusScore: entry.consensusScore,
      raterCount: entry.raterCount,
      level: entry.level,
      updatedAt: entry.updatedAt,
    });
    this.store?.bumpRaterTrust?.(raterId);
    return entry;
  }

  /** Ingest a signed remote rating with Byzantine-style attestation verification (B1). */
  ingestRemoteRating(jws: string): { ok: boolean; entry?: ReputationEntry; reason?: string } {
    const verified = verifyReputationAttestation(jws);
    if (!verified.valid || !verified.payload) {
      return { ok: false, reason: verified.reason ?? 'invalid_attestation' };
    }
    const { serverName, packageName, dimensions, raterId, raterWeight } = verified.payload;
    const edges = loadTrustEdgesFromStore(this.store);
    const anchor = resolveTrustAnchor();
    if (raterId !== anchor && edges.length > 0) {
      const trust = computeTransitiveTrust(raterId, edges, anchor);
      if (trust < Number(process.env.GUARDIAN_REPUTATION_MIN_TRUST ?? '0.35')) {
        return { ok: false, reason: `untrusted_rater:${raterId} (trust=${trust.toFixed(2)})` };
      }
    }
    const entry = this.rateServer({
      serverName,
      packageName,
      dimensions,
      raterId,
      raterWeight,
    });
    this.store?.saveReputationTrustEdge?.({
      fromRaterId: anchor,
      toRaterId: raterId,
      weight: Math.min(1, (raterWeight ?? 1) / 2),
    });
    return { ok: true, entry };
  }

  /** Byzantine quorum merge over persisted rater votes (B1). */
  private applyByzantineQuorum(serverHash: string, fallback: ReputationEntry): ReputationEntry {
    const votes = this.store?.listReputationRaterVotes?.(serverHash) ?? [];
    if (votes.length === 0) return fallback;
    const quorum = mergeRatingsWithQuorum(
      votes.map(v => ({
        raterId: v.raterId,
        dimensions: v.dimensions as Partial<ReputationDimensions>,
        raterWeight: v.raterWeight,
      })),
    );
    if (!quorum.quorumMet || !quorum.dimensions) return fallback;
    return {
      ...fallback,
      dimensions: quorum.dimensions,
      consensusScore: quorum.consensusScore,
      raterCount: quorum.weightedVotes,
      level: levelFromScore(quorum.consensusScore),
    };
  }

  queryServerReputation(serverName: string, packageName?: string): ReputationEntry | null {
    const hash = hashServer(serverName, packageName);
    const stored = this.entries.get(hash) ?? this.store?.getReputationEntry?.(hash);
    if (!stored) return null;
    return {
      serverHash: stored.serverHash,
      dimensions: stored.dimensions as ReputationDimensions,
      consensusScore: stored.consensusScore,
      raterCount: stored.raterCount,
      level: stored.level as ReputationEntry['level'],
      updatedAt: stored.updatedAt,
    };
  }

  /** Pull cloud consensus when local entry missing (B1 network effects). */
  async queryWithNetwork(serverName: string, packageName?: string): Promise<ReputationEntry | null> {
    const local = this.queryServerReputation(serverName, packageName);
    if (local && local.raterCount > 0) return local;

    const relayUrl = process.env.GUARDIAN_REPUTATION_RELAY_URL?.trim()
      ?? process.env.GUARDIAN_CLOUD_URL?.trim();
    if (!relayUrl) return local;

    try {
      const url = new URL('/api/v1/reputation/query', relayUrl.replace(/\/$/, ''));
      url.searchParams.set('server', serverName);
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return local;
      const body = await res.json() as {
        consensusScore?: number;
        raterCount?: number;
        level?: string;
        dimensions?: Partial<ReputationDimensions>;
        attestationJws?: string;
      };
      if (body.attestationJws) {
        const ingested = this.ingestRemoteRating(body.attestationJws);
        if (ingested.ok && ingested.entry) return ingested.entry;
      }
      if (!body.consensusScore) return local;
      return this.rateServer({
        serverName,
        packageName,
        dimensions: body.dimensions ?? {},
        raterWeight: Math.max(1, body.raterCount ?? 1),
      });
    } catch {
      return local;
    }
  }

  /** Cross-check local certification tier against network reputation (B1). */
  validateCertAgainstReputation(
    serverName: string,
    certLevel: string,
    packageName?: string,
  ): { valid: boolean; reason?: string; networkLevel?: string } {
    const rep = this.queryServerReputation(serverName, packageName);
    if (!rep) return { valid: true, reason: 'no_network_entry' };

    const levelRank: Record<string, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 };
    const certRank = levelRank[certLevel.toLowerCase()] ?? 0;
    const netRank = levelRank[rep.level] ?? 0;

    if (certRank > netRank) {
      return {
        valid: false,
        networkLevel: rep.level,
        reason: `Local cert ${certLevel} exceeds network consensus ${rep.level} (score=${rep.consensusScore})`,
      };
    }
    return { valid: true, networkLevel: rep.level };
  }

  buildFromGuardianScore(serverName: string, score: ReturnType<GuardianScore['compute']>): ReputationEntry {
    const byName = (n: string) => score.categories.find(c => c.name === n)?.score ?? 50;
    return this.rateServer({
      serverName,
      dimensions: {
        security_posture: byName('Transport Security'),
        auth_strength: byName('Authentication Strength'),
        cve_hygiene: byName('CVE Posture'),
        publisher_trust: byName('Supply Chain Integrity'),
        policy_compliance: score.overallScore,
        uptime: byName('Configuration Freshness'),
        community_rating: score.overallScore,
        guardian_protected: score.includesLiveData ? 100 : 50,
      },
    });
  }

  /** Publish local rating via mesh-relay-client (B1) with HTTP cloud fallback. */
  async publishToMeshRelay(serverName: string, packageName?: string): Promise<{ published: boolean; error?: string; via?: string }> {
    const entry = this.queryServerReputation(serverName, packageName);
    if (!entry) return { published: false, error: 'no_local_entry' };

    const { publishReputationViaMeshRelay } = await import('./mesh-relay-publish.js');
    const mesh = await publishReputationViaMeshRelay(serverName, entry, packageName);
    if (mesh.published) return { published: true, via: mesh.via };

    const relayUrl = process.env.GUARDIAN_REPUTATION_RELAY_URL?.trim();
    if (!relayUrl) return { published: false, error: mesh.error ?? 'relay_not_configured' };
    try {
      const res = await fetch(`${relayUrl.replace(/\/$/, '')}/api/v1/reputation/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName, packageName, dimensions: entry.dimensions }),
      });
      if (!res.ok) return { published: false, error: `relay ${res.status}` };
      return { published: true, via: 'http' };
    } catch (err: unknown) {
      return { published: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
