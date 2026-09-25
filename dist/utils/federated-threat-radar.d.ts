/**
 * Federated threat radar — privacy-preserving org-level stats (no raw payloads).
 */
import type { StoredSemanticAudit } from '../ai/semantic-audit-store.js';
export type FederatedThreatStats = {
    tenantId: string;
    region: string;
    generatedAt: string;
    attackClassCounts: Record<string, number>;
    ruleEfficacy: Array<{
        rule: string;
        blocks: number;
    }>;
    thresholdRecommendation: {
        recommendedMinConfidence: number;
        recommendedLocalThreshold: number;
        labeledCount: number;
        rationale: string;
    };
    optIn: boolean;
};
export declare function buildLocalFederatedStats(tenantId: string, region: string, semanticRecords: StoredSemanticAudit[]): FederatedThreatStats;
export declare function mergeFederatedStats(stats: FederatedThreatStats[]): {
    attackClassCounts: Record<string, number>;
    ruleEfficacy: Array<{
        rule: string;
        blocks: number;
    }>;
    instanceCount: number;
};
export declare function collectFederatedThreatStats(): Promise<FederatedThreatStats | null>;
//# sourceMappingURL=federated-threat-radar.d.ts.map