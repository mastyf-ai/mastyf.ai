import { createDatabase } from '../database/create-database.js';
export interface HourlyBucket {
    hourStart: string;
    calls: number;
    blocked: number;
    passed: number;
    passRatePct: number;
    costUsd: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
}
export interface VisualsDataBundle {
    generatedAt: string;
    windowDays: number;
    meta: {
        dbPath: string;
        tenantId?: string;
        hasTraffic: boolean;
        hasInstantLearning: boolean;
        hasSemantic: boolean;
        swarmSessionLive: boolean;
        dataSources: {
            traffic: 'history.db' | 'none';
            semantic: 'semantic-audit-store' | 'none';
            regression: 'session-swarm' | 'none';
            pipeline: 'session-swarm' | 'none';
        };
        emptyReasons: Record<string, string>;
        recordCount?: number;
        sparse?: boolean;
        window?: string;
        generatedAt?: string;
    };
    traffic: {
        hasData: boolean;
        totalCalls: number;
        totalBlocked: number;
        hourly: HourlyBucket[];
        byServer: Array<{
            serverName: string;
            calls: number;
            blocked: number;
            costUsd: number;
            latencyP50Ms: number;
            latencyP95Ms: number;
        }>;
        topTools: Array<{
            tool: string;
            count: number;
        }>;
        topBlockRules: Array<{
            rule: string;
            count: number;
            plainEnglish: string;
        }>;
    };
    instantLearning: {
        source: 'live' | 'history-db-fallback' | 'simulated-eval' | 'none';
        totalEvents: number;
        queuedSuggestions: number;
        blocksPerMinute: Array<{
            t: number;
            value: number;
        }>;
        ruleToolPairs: Array<{
            key: string;
            rule: string;
            tool: string;
            count: number;
        }>;
        classConfidence: Array<{
            class: string;
            confidence: number;
        }>;
        medianBlocksToSuggestion?: number;
        suggestionEngine?: {
            learningInitialized: boolean;
            cyclesCompleted: number;
            baselinesCount: number;
            recordsAnalyzed: number;
            suggestionsGenerated: number;
        };
    };
    semantic: {
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
    regression: {
        gates: Record<string, unknown> | null;
        overall: boolean | null;
        categoryRecall: Array<{
            category: string;
            recallPct: number;
            total: number;
        }>;
        userServers: Array<{
            serverName: string;
            status: string;
            toolCount: number;
        }>;
    };
    pipeline: {
        phases: Array<{
            id: string;
            label: string;
            progressPct: number;
        }>;
        jobState: string | null;
        stepTimings: Array<{
            label: string;
            elapsedSec: number;
        }>;
        totalSec: number;
    };
}
export declare function buildVisualsData(opts?: {
    windowDays?: number;
    dbPath?: string;
    tenantId?: string;
    /** Reuse proxy/dashboard DB — avoids open/close churn on /api/visuals/live */
    historyDb?: Awaited<ReturnType<typeof createDatabase>>;
}): Promise<VisualsDataBundle>;
export declare function writeVisualsData(opts?: {
    windowDays?: number;
    dbPath?: string;
    tenantId?: string;
    historyDb?: Awaited<ReturnType<typeof createDatabase>>;
}): Promise<VisualsDataBundle>;
export declare function readVisualsData(tenantId?: string): VisualsDataBundle | null;
//# sourceMappingURL=export-visuals-data.d.ts.map