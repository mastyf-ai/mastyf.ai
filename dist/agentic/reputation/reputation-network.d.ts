import type { IndustryStandardStore } from '../../database/industry-standard-store.js';
import type { MastyfAiScore } from '../trust-score/mastyf-ai-score.js';
export type ReputationDimension = 'security_posture' | 'auth_strength' | 'cve_hygiene' | 'publisher_trust' | 'policy_compliance' | 'uptime' | 'community_rating' | 'mastyf-ai_protected';
export interface ReputationDimensions {
    security_posture: number;
    auth_strength: number;
    cve_hygiene: number;
    publisher_trust: number;
    policy_compliance: number;
    uptime: number;
    community_rating: number;
    mastyf_ai_protected: number;
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
export declare class ReputationNetwork {
    private readonly store?;
    private readonly mastyfAiScore?;
    private entries;
    constructor(store?: IndustryStandardStore | undefined, mastyfAiScore?: MastyfAiScore | undefined);
    rateServer(params: {
        serverName: string;
        packageName?: string;
        dimensions: Partial<ReputationDimensions>;
        raterWeight?: number;
        raterId?: string;
    }): ReputationEntry;
    /** Ingest a signed remote rating with Byzantine-style attestation verification (B1). */
    ingestRemoteRating(jws: string): {
        ok: boolean;
        entry?: ReputationEntry;
        reason?: string;
    };
    /** Byzantine quorum merge over persisted rater votes (B1). */
    private applyByzantineQuorum;
    queryServerReputation(serverName: string, packageName?: string): ReputationEntry | null;
    /** Pull cloud consensus when local entry missing (B1 network effects). */
    queryWithNetwork(serverName: string, packageName?: string): Promise<ReputationEntry | null>;
    /** Cross-check local certification tier against network reputation (B1). */
    validateCertAgainstReputation(serverName: string, certLevel: string, packageName?: string): {
        valid: boolean;
        reason?: string;
        networkLevel?: string;
    };
    buildFromMastyfAiScore(serverName: string, score: ReturnType<MastyfAiScore['compute']>): ReputationEntry;
    /** Publish local rating via mesh-relay-client (B1) with HTTP cloud fallback. */
    publishToMeshRelay(serverName: string, packageName?: string): Promise<{
        published: boolean;
        error?: string;
        via?: string;
    }>;
}
//# sourceMappingURL=reputation-network.d.ts.map