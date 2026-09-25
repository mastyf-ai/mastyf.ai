export declare const REPO_ROOT: string;
/** Legacy global swarm dir (default tenant fallback). */
export declare const SWARM_DIR: string;
export declare const LIVE_SESSION_PATH: string;
export declare function readSwarmJsonFile<T>(name: string, tenantId?: string): T | null;
export declare function readLiveFilesystemSession(tenantId?: string): Record<string, unknown> | null;
export declare function readSwarmLatest(tenantId?: string): Record<string, unknown> | null;
export declare function readSwarmSummaryMd(tenantId?: string): string | null;
export declare function listSwarmFigures(tenantId?: string): string[];
export interface SwarmFigureEntry {
    name: string;
    title: string;
    category: string;
    url: string;
    generatedAt?: string;
    dataSource?: string;
}
export declare function readFiguresManifest(tenantId?: string): {
    generatedAt?: string;
    figures: SwarmFigureEntry[];
};
export declare function readVisualsData(tenantId?: string): Record<string, unknown> | null;
export declare function visualsDataPath(tenantId: string): string;
export declare function readSwarmFigure(name: string, tenantId?: string): Buffer | null;
export declare function readUserServersSession(tenantId?: string): Record<string, unknown> | null;
export declare function readTrafficSummary(tenantId?: string): Record<string, unknown> | null;
export declare function readPlainEnglishReport(tenantId?: string): Record<string, unknown> | null;
/** Build report.json from latest.json / analysis artifacts when missing (e.g. pre-MVP runs). */
export declare function ensurePlainEnglishReport(tenantId?: string): Record<string, unknown> | null;
export declare function readSwarmTextArtifact(name: string, tenantId?: string): string | null;
export declare function ensureTenantSwarmDir(tenantId: string): string;
export type ThreatLabCandidateRecord = {
    id: string;
    fingerprint: string;
    attackClass: string;
    hypothesis: string;
    confidence: number;
    path?: string;
    branch?: string;
    toolName?: string;
    category?: string;
    reviewStatus?: 'pending' | 'accepted' | 'rejected';
    policyRule?: Record<string, unknown>;
    corpusCandidate?: Record<string, unknown>;
    provenance?: {
        source?: string;
        llmUsed?: boolean;
        inputFingerprint?: string;
    };
    validation?: {
        ok?: boolean;
        errors?: string[];
        replayBlocked?: boolean;
    };
    advWriteSkipped?: string;
};
export declare function readThreatLabCandidates(tenantId?: string): {
    timestamp?: string;
    count?: number;
    mode?: string;
    llmModel?: string;
    llmUsed?: boolean;
    skipped?: string;
    runNote?: string;
    candidates: ThreatLabCandidateRecord[];
} | null;
export declare function readThreatLabCandidateById(tenantId: string | undefined, id: string): ThreatLabCandidateRecord | null;
/** Read Threat Lab candidates without dashboard session gating (incident investigator). */
export declare function readThreatLabCandidatesUngated(tenantId?: string): ThreatLabCandidateRecord[];
export declare function findThreatLabCandidateUngated(tenantId: string | undefined, triggerId: string): ThreatLabCandidateRecord | null;
export type AutoCorpusManifestEntry = {
    advId: string;
    relPath: string;
    fingerprint: string;
    source: string;
    attackClass: string;
    hypothesis: string;
    confidence: number;
    timestamp: string;
    toolName: string;
    category: string;
};
export declare function readAutoCorpusManifestUngated(tenantId?: string): AutoCorpusManifestEntry[];
export declare function readAutoCorpusManifest(tenantId?: string): {
    timestamp: string;
    count: number;
    entries: AutoCorpusManifestEntry[];
} | null;
export declare function markThreatLabCandidate(tenantId: string | undefined, id: string, status: 'accepted' | 'rejected'): boolean;
/**
 * Upsert a Threat Lab candidate (used by Vuln Discovery propose-block).
 * Creates the manifest file under the tenant swarm dir when missing.
 */
export declare function upsertThreatLabCandidate(tenantId: string | undefined, candidate: ThreatLabCandidateRecord): ThreatLabCandidateRecord;
//# sourceMappingURL=swarm-artifacts.d.ts.map