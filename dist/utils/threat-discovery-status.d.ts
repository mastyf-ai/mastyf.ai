import { getThreatResearchConfig, getThreatResearchQueueStatus } from '../ai/threat-research-pipeline.js';
import { readThreatLabCandidates, readAutoCorpusManifest, type ThreatLabCandidateRecord, type AutoCorpusManifestEntry } from './swarm-artifacts.js';
import { parseAutoResearchLogTail } from './parse-auto-research-log.js';
import { type ThreatDiscoveryJobStatus } from './threat-discovery-runner.js';
import { swarmDataProvenance } from './swarm-session.js';
declare function aggregateThreatLab(candidates: ThreatLabCandidateRecord[]): {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    byReviewStatus: Record<string, number>;
    bySource: Record<string, number>;
    byAttackClass: Record<string, number>;
    avgConfidence: number;
    confidenceBuckets: {
        bucket: string;
        count: number;
    }[];
};
declare function aggregateAutoCorpus(entries: AutoCorpusManifestEntry[]): {
    total: number;
    last24h: number;
    bySource: Record<string, number>;
    byAttackClass: Record<string, number>;
    timeline: {
        advId: string;
        timestamp: string;
        source: string;
        confidence: number;
    }[];
};
export interface ThreatDiscoveryStatus {
    timestamp: string;
    license: {
        swarmFeature: boolean;
        bypass: boolean;
    };
    features: {
        threatLabEnabled: boolean;
        threatLabMode: 'reactive' | 'proactive';
        threatLabMax: number;
        threatLabSemantic: boolean;
        autoResearchEnabled: boolean;
        autoResearchConfig: ReturnType<typeof getThreatResearchConfig>;
    };
    llm: {
        ok: boolean;
        reason?: string;
        model?: string;
    };
    pipeline: ReturnType<typeof getThreatResearchQueueStatus>;
    processedFingerprints: number;
    threatLab: {
        manifest: ReturnType<typeof readThreatLabCandidates>;
        stats: ReturnType<typeof aggregateThreatLab>;
    };
    autoCorpus: {
        manifest: ReturnType<typeof readAutoCorpusManifest>;
        stats: ReturnType<typeof aggregateAutoCorpus>;
    };
    jobs: {
        threatLab: ThreatDiscoveryJobStatus;
        autoResearch: ThreatDiscoveryJobStatus & {
            parsed: ReturnType<typeof parseAutoResearchLogTail>;
        };
    };
    provenance: ReturnType<typeof swarmDataProvenance>;
}
export declare function buildThreatDiscoveryStatus(tenantId: string): Promise<ThreatDiscoveryStatus>;
/** Test helper — clear LLM health cache. */
export declare function resetThreatDiscoveryStatusCacheForTests(): void;
export {};
//# sourceMappingURL=threat-discovery-status.d.ts.map