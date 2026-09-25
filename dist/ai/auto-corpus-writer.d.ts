import type { ThreatLabDiscovery } from './threat-lab.js';
export type AutoCorpusSource = 'semantic_flag' | 'block_repeat' | 'threat_intel' | 'bypass' | 'corpus_proactive' | 'dependency_anomaly' | 'vuln_discovery';
export interface AutoCorpusProvenance {
    source: AutoCorpusSource;
    inputFingerprint: string;
    llmUsed: boolean;
    attackClass: string;
    hypothesis: string;
    confidence: number;
}
export interface AutoCorpusWriteResult {
    advId: string;
    relPath: string;
    fingerprint: string;
}
export declare function candidateFingerprint(discovery: ThreatLabDiscovery): string;
export declare function customAttacksDir(): string;
/** Resolve at call time — swarm dir can change after module load (fleet/dashboard). */
export declare function autoCorpusManifestPath(): string;
export declare function threatResearchProcessedPath(): string;
export declare function nextAdvId(customDir?: string): string;
export declare function markThreatResearchProcessed(fp: string): void;
export declare function isFingerprintProcessed(fp: string): boolean;
export declare function countProcessedFingerprints(): number;
type ManifestEntry = AutoCorpusWriteResult & AutoCorpusProvenance & {
    timestamp: string;
    toolName: string;
    category: string;
    /** Operator review status for dashboard Pending Review queue */
    status?: 'pending' | 'approved' | 'rejected';
};
export type AutoCorpusManifestEntry = ManifestEntry;
/** Set review status on a swarm auto-corpus manifest entry (dashboard Approve/Reject). */
export declare function setAutoCorpusManifestStatus(advId: string, status: 'pending' | 'approved' | 'rejected'): {
    ok: boolean;
    error?: string;
    entry?: ManifestEntry;
};
/** Approve or reject all pending writer-manifest entries. */
export declare function setAllPendingAutoCorpusStatus(status: 'approved' | 'rejected'): {
    ok: boolean;
    count: number;
};
export declare function writeAutoCorpusFixture(discovery: ThreatLabDiscovery, provenance: AutoCorpusProvenance): AutoCorpusWriteResult | null;
export declare function readAutoCorpusManifest(): {
    timestamp: string;
    count: number;
    entries: ManifestEntry[];
} | null;
export {};
//# sourceMappingURL=auto-corpus-writer.d.ts.map