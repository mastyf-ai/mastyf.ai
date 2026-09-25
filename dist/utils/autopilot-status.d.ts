import { readAutopilotConfig, readLastDigestMeta } from './autopilot-config.js';
import { readRecentLearningEvents } from './learning-events.js';
import { getSchedulerStatus } from './threat-discovery-scheduler.js';
import { getThreatResearchQueueStatus } from '../ai/threat-research-pipeline.js';
export type AutopilotStatus = {
    timestamp: string;
    autopilotEnabled: boolean;
    config: ReturnType<typeof readAutopilotConfig>;
    license: {
        pro: boolean;
        swarm: boolean;
        ai: boolean;
        dashboard: boolean;
    };
    protection: {
        historyDbAttached: boolean;
        policyAutoApply: boolean;
    };
    learning: {
        aiEnabled: boolean;
        pendingSuggestions: number;
        threatResearchEnabled: boolean;
        threatResearchQueue: ReturnType<typeof getThreatResearchQueueStatus>;
    };
    scheduler: ReturnType<typeof getSchedulerStatus>;
    lastDigest: ReturnType<typeof readLastDigestMeta>;
    recentEvents: ReturnType<typeof readRecentLearningEvents>;
    llm: {
        ok: boolean;
        reason?: string;
    };
    messages: string[];
};
export declare function buildAutopilotStatus(tenantId?: string, historyDbAttached?: boolean): Promise<AutopilotStatus>;
//# sourceMappingURL=autopilot-status.d.ts.map