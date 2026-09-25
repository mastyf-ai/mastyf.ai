import { getThreatResearchConfig, getThreatResearchQueueStatus } from '../ai/threat-research-pipeline.js';
import { type LearningEvent } from './learning-events.js';
import { parseAutoResearchLogTail } from './parse-auto-research-log.js';
import { getSchedulerStatus } from './threat-discovery-scheduler.js';
import { getThreatDiscoveryJobStatus } from './threat-discovery-runner.js';
import { type ThreatLabCandidateRecord, type AutoCorpusManifestEntry } from './swarm-artifacts.js';
declare function aggregateCandidates(candidates: ThreatLabCandidateRecord[]): {
    total: number;
    pending: number;
    byReviewStatus: Record<string, number>;
};
declare function aggregateCorpus(entries: AutoCorpusManifestEntry[]): {
    total: number;
    last24h: number;
    recent: AutoCorpusManifestEntry[];
};
declare function aggregateLearning(events: LearningEvent[]): {
    recent: LearningEvent[];
    counts24h: Record<string, number>;
};
export interface ThreatAutomationSummary {
    timestamp: string;
    scheduler: ReturnType<typeof getSchedulerStatus>;
    features: {
        autoResearchEnabled: boolean;
        threatLabMode: 'reactive' | 'proactive';
        autoResearchConfig: ReturnType<typeof getThreatResearchConfig>;
    };
    llm: {
        ok: boolean;
        reason?: string;
        model?: string;
    };
    pipeline: ReturnType<typeof getThreatResearchQueueStatus> & {
        ephemeral: true;
    };
    processedFingerprints: number;
    jobs: {
        autoResearch: ReturnType<typeof getThreatDiscoveryJobStatus> & {
            parsed: ReturnType<typeof parseAutoResearchLogTail>;
        };
        threatLab: ReturnType<typeof getThreatDiscoveryJobStatus> & {
            parsed: {
                wroteAuthentic: number | null;
            };
        };
    };
    autoCorpus: ReturnType<typeof aggregateCorpus>;
    threatLab: ReturnType<typeof aggregateCandidates>;
    learning: ReturnType<typeof aggregateLearning>;
    promotion: {
        enabled: boolean;
        totalPromoted: number;
        dailyQuota: {
            used: number;
            max: number;
        };
        lastPromotionAt: string | null;
    };
}
export declare function buildThreatAutomationSummary(tenantId: string): Promise<ThreatAutomationSummary>;
export {};
//# sourceMappingURL=threat-automation-summary.d.ts.map