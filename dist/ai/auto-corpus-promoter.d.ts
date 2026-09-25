import type { ThreatLabDiscovery } from './threat-lab.js';
import type { AutoCorpusSource } from './auto-corpus-writer.js';
export interface CorpusPromotionProvenance {
    source: AutoCorpusSource;
    inputFingerprint: string;
    attackClass: string;
    hypothesis: string;
    confidence: number;
    llmUsed: boolean;
    advId: string;
}
export interface CorpusPromotionResult {
    ok: boolean;
    relPath?: string;
    category?: string;
    reason?: string;
}
export interface CorpusPromotionManifest {
    timestamp: string;
    count: number;
    entries: Array<{
        relPath: string;
        category: string;
        advId: string;
        confidence: number;
        source: AutoCorpusSource;
        promotedAt: string;
        status?: 'pending' | 'approved' | 'rejected' | 'promoted';
    }>;
}
export declare function promoteToCorpus(discovery: ThreatLabDiscovery, provenance: CorpusPromotionProvenance): Promise<CorpusPromotionResult>;
/** Batch promote multiple discoveries. */
export declare function promoteBatchToCorpus(discoveries: Array<{
    discovery: ThreatLabDiscovery;
    provenance: CorpusPromotionProvenance;
}>): Promise<CorpusPromotionResult[]>;
/** Get promotion statistics for dashboard. */
export declare function getPromotionStats(): {
    enabled: boolean;
    dailyQuota: {
        used: number;
        max: number;
    };
    totalPromoted: number;
    byCategory: Record<string, number>;
    lastPromotionAt: string | null;
};
/** Export: list entries that are still pending review */
export declare function listPendingPromotions(): Array<{
    advId: string;
    category: string;
    confidence: number;
    source: string;
    createdAt: string;
}>;
/** Export: mark an entry as approved for promotion */
export declare function approveAutoCorpusEntry(advId: string): {
    ok: boolean;
    error?: string;
};
/** Export: mark an entry as rejected */
export declare function rejectAutoCorpusEntry(advId: string): {
    ok: boolean;
    error?: string;
};
/** Export: approve all pending entries */
export declare function approveAllPending(): {
    ok: boolean;
    count: number;
};
/** Exported for test use */
export declare function resetPromotionStateForTests(): void;
//# sourceMappingURL=auto-corpus-promoter.d.ts.map