/**
 * B1 — Transitive rater trust propagation (decentralized web-of-trust analog).
 */
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';

export interface TrustEdge {
  fromRaterId: string;
  toRaterId: string;
  weight: number;
}

const DEFAULT_ANCHOR = () => process.env.GUARDIAN_REPUTATION_TRUST_ANCHOR?.trim()
  ?? process.env.GUARDIAN_TENANT_ID?.trim()
  ?? 'local-rater';

export function resolveTrustAnchor(): string {
  return DEFAULT_ANCHOR();
}

/** BFS propagation from anchor rater; decays trust by edge weight product. */
export function computeTransitiveTrust(
  targetRaterId: string,
  edges: TrustEdge[],
  anchorRaterId = resolveTrustAnchor(),
  maxDepth = 4,
): number {
  if (targetRaterId === anchorRaterId) return 1.0;

  const adj = new Map<string, Array<{ to: string; weight: number }>>();
  for (const e of edges) {
    const list = adj.get(e.fromRaterId) ?? [];
    list.push({ to: e.toRaterId, weight: Math.max(0.01, Math.min(1, e.weight)) });
    adj.set(e.fromRaterId, list);
  }

  const queue: Array<{ id: string; trust: number; depth: number }> = [{ id: anchorRaterId, trust: 1, depth: 0 }];
  const best = new Map<string, number>();

  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.depth >= maxDepth) continue;
    for (const next of adj.get(cur.id) ?? []) {
      const propagated = cur.trust * next.weight * 0.92;
      const prev = best.get(next.to) ?? 0;
      if (propagated <= prev) continue;
      best.set(next.to, propagated);
      queue.push({ id: next.to, trust: propagated, depth: cur.depth + 1 });
    }
  }

  const direct = best.get(targetRaterId);
  if (direct != null) return Math.min(1, direct);
  return 0.25;
}

export function isRaterTrusted(
  targetRaterId: string,
  edges: TrustEdge[],
  minTrust = Number(process.env.GUARDIAN_REPUTATION_MIN_TRUST ?? '0.35'),
): boolean {
  return computeTransitiveTrust(targetRaterId, edges) >= minTrust;
}

export function loadTrustEdgesFromStore(store?: IndustryStandardStore): TrustEdge[] {
  return store?.listReputationTrustEdges?.() ?? [];
}
