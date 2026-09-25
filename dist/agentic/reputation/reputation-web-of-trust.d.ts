/**
 * B1 — Transitive rater trust propagation (decentralized web-of-trust analog).
 */
import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
export interface TrustEdge {
    fromRaterId: string;
    toRaterId: string;
    weight: number;
}
export declare function resolveTrustAnchor(): string;
/** BFS propagation from anchor rater; decays trust by edge weight product. */
export declare function computeTransitiveTrust(targetRaterId: string, edges: TrustEdge[], anchorRaterId?: string, maxDepth?: number): number;
export declare function isRaterTrusted(targetRaterId: string, edges: TrustEdge[], minTrust?: number): boolean;
export declare function loadTrustEdgesFromStore(store?: IndustryStandardStore): TrustEdge[];
//# sourceMappingURL=reputation-web-of-trust.d.ts.map