import { type BypassContext, type ThreatLabDiscovery, type CorpusCandidate, type ThreatLabCandidateProvenance, type ThreatLabSource } from './threat-lab.js';
import { type AutoCorpusSource } from './auto-corpus-writer.js';
export { countProcessedFingerprints } from './auto-corpus-writer.js';
import type { StoredSemanticAudit } from './semantic-audit-store.js';
import type { ThreatIntelEntry } from './threat-intel.js';
export type ThreatResearchEventType = AutoCorpusSource;
export interface ThreatResearchEvent {
    type: ThreatResearchEventType;
    fingerprint: string;
    confidence?: number;
    bypass?: BypassContext;
    semanticRecord?: StoredSemanticAudit;
    threatEntry?: ThreatIntelEntry;
    corpusSeed?: CorpusCandidate & {
        relPath?: string;
    };
    blockRule?: string;
    toolName?: string;
    /** Pre-advisory dependency / VDE finding context */
    vulnFinding?: {
        id: string;
        class: string;
        severity: string;
        title: string;
        description: string;
        target: {
            kind: string;
            name: string;
            version?: string;
        };
        evidence: {
            reproSteps: string[];
            scanner: string;
        };
    };
}
export interface ThreatResearchResult {
    ok: boolean;
    advId?: string;
    relPath?: string;
    reason?: string;
    fingerprint?: string;
}
export type AutoCorpusWriteInput = {
    discovery: ThreatLabDiscovery;
    source: AutoCorpusSource;
    inputFingerprint: string;
    llmUsed?: boolean;
};
/** Map Threat Lab provenance sources to auto-corpus writer sources. */
export declare function threatLabSourceToAutoCorpusSource(source: ThreatLabSource): AutoCorpusSource;
/**
 * Write a Threat Lab–validated discovery via the auto-corpus path (no second LLM call, no rate limit).
 */
export declare function writeValidatedDiscoveryToAutoCorpus(discovery: ThreatLabDiscovery, provenance: ThreatLabCandidateProvenance, opts?: {
    requireReplayBlock?: boolean;
}): Promise<ThreatResearchResult>;
export declare function threatResearchAutoEnabled(): boolean;
/** When true, Threat Lab writes adv fixtures via the auto-corpus path (not legacy direct writes). */
export declare function autoThreatResearchOwnsAdvWrites(): boolean;
export interface ThreatResearchQueueStatus {
    queued: number;
    writesThisHour: number;
    maxPerHour: number;
    debounceMs: number;
    enabled: boolean;
    sources: {
        semantic: boolean;
        blocks: boolean;
        threatIntel: boolean;
    };
}
export interface ThreatResearchConfig {
    autoEnabled: boolean;
    swarmAutoEnabled: boolean;
    ownsAdvWrites: boolean;
    minConfidence: number;
    semanticMinConfidence: number;
    requireReplay: boolean;
    maxPerHour: number;
    debounceMs: number;
    batchMax: number;
    proactiveEnabled: boolean;
    sources: ThreatResearchQueueStatus['sources'];
}
export declare function getThreatResearchConfig(): ThreatResearchConfig;
export declare function getThreatResearchQueueStatus(): ThreatResearchQueueStatus;
export declare function enqueueThreatResearch(event: ThreatResearchEvent): void;
export declare function processThreatResearchEvent(event: ThreatResearchEvent): Promise<ThreatResearchResult>;
export declare function processThreatResearchBatch(events: ThreatResearchEvent[]): Promise<ThreatResearchResult[]>;
/** Test helper — reset in-memory queue and hourly rate limit state. */
export declare function resetThreatResearchQueueForTests(): void;
export interface BlockRepeatWindowBlock {
    blockReason: string;
    argsFingerprint: string;
    argSnippets?: string[];
    arguments?: Record<string, unknown>;
}
export declare function buildBlockRepeatEvent(blockRule: string, toolName: string, blockReason: string, argsFingerprint: string, opts?: {
    arguments?: Record<string, unknown>;
    argSnippets?: string[];
    windowBlocks?: BlockRepeatWindowBlock[];
}): ThreatResearchEvent;
export declare function buildSemanticFlagEvent(record: StoredSemanticAudit): ThreatResearchEvent;
export declare function buildThreatIntelEvent(entry: ThreatIntelEntry): ThreatResearchEvent;
/** Pre-advisory npm audit / SBOM finding without a published CVE. */
export declare function buildDependencyAnomalyEvent(finding: {
    id: string;
    class: string;
    severity: string;
    title: string;
    description: string;
    target: {
        kind: string;
        name: string;
        version?: string;
    };
    evidence: {
        reproSteps: string[];
        scanner: string;
    };
    fingerprint?: string;
}): ThreatResearchEvent;
export declare function buildVulnDiscoveryEvent(finding: {
    id: string;
    class: string;
    severity: string;
    title: string;
    description: string;
    target: {
        kind: string;
        name: string;
        version?: string;
    };
    evidence: {
        reproSteps: string[];
        scanner: string;
    };
    fingerprint?: string;
}): ThreatResearchEvent;
export declare function buildBypassEvent(bypass: BypassContext): ThreatResearchEvent;
export declare function buildCorpusProactiveEvents(limit: number): ThreatResearchEvent[];
/** Live block-repeat signals from instant attack-learning state (batch job + runtime queue). */
export declare function buildBlockRepeatEventsFromAttackState(limit: number, tenantId?: string): ThreatResearchEvent[];
/** Prefer signals not yet in the processed ledger (avoids wasted LLM calls on reruns). */
export declare function filterUnprocessedEvents(events: ThreatResearchEvent[]): ThreatResearchEvent[];
//# sourceMappingURL=threat-research-pipeline.d.ts.map