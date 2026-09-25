/**
 * Live semantic audit aggregates for dashboard visuals (no calibration.json).
 */
import type { StoredSemanticAudit } from '../ai/semantic-audit-store.js';
export type SemanticVisualsSlice = {
    hasData: boolean;
    totals: Record<string, number>;
    confidenceBuckets: Array<{
        bucket: string;
        count: number;
    }>;
    labelMix: Array<{
        label: string;
        count: number;
    }>;
    avgFlagConfidence: number;
};
export declare function buildSemanticVisualsFromRecords(records: StoredSemanticAudit[]): SemanticVisualsSlice;
//# sourceMappingURL=semantic-visuals.d.ts.map