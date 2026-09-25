/**
 * Aggregated agentic dashboard metrics (history DB + in-memory agentic services).
 */
import type { IDatabase } from '../database/database-interface.js';
import type { Container } from '../container.js';
import type { TrustScore } from '../agentic/trust-score/mastyf-ai-score.js';
import type { AgenticDecisionRecord } from '../agentic/telemetry.js';
import { type ServerRegistryEntry } from './server-registry.js';
import { type ChartMetaEnvelope } from './chart-meta.js';
import { type DashboardWindow } from './time-buckets.js';
export type AgenticTrafficPoint = {
    bucket: string;
    requests: number;
    blocked: number;
};
export type AgenticServerTrust = {
    name: string;
    transport: string;
    wrapped: boolean;
    metrics?: ServerRegistryEntry['metrics'];
    trust: TrustScore | null;
};
export type AgenticDashboardSummary = {
    available: boolean;
    agenticEnabled: boolean;
    hasProxyHistory: boolean;
    windowDays: number;
    generatedAt: string;
    kpis: {
        uptimeMs: number;
        totalDecisions: number;
        avgConfidence: number;
        llmTokensUsed: number;
        llmCostEstimate: number;
        llmAvailable: boolean;
        blockedRequests: number;
        totalRequests: number;
        injectionDetectionRate: number;
        injectionScans: number;
        meshSignatures: number;
        meshEnabled: boolean;
        decoyActive: number;
        decoyCaptures: number;
        taskQueued: number;
        taskRunning: number;
        complianceOverall: number;
        trustGrade: string;
        trustScore: number;
        activeSessions: number;
    } | null;
    trafficSeries: AgenticTrafficPoint[];
    decisionsByFeature: Record<string, number>;
    recentDecisions: AgenticDecisionRecord[];
    featureHealth: Array<{
        name: string;
        status: string;
    }>;
    servers: AgenticServerTrust[];
    compliance: {
        overall: number;
        frameworks: Array<{
            framework: string;
            frameworkName: string;
            postureScore: number;
            satisfiedControls: number;
            totalControls: number;
        }>;
    };
    policyGen: {
        active: boolean;
        totalCalls: number;
        uniqueTools: number;
        uptimeMin: number;
    };
    decoys: {
        active: number;
        totalCaptures: number;
        recentAlerts: number;
    } | null;
    mesh: {
        enabled: boolean;
        localSignatures: number;
        pendingSignatures: number;
    };
    promptInjectionStats: {
        totalScans: number;
        totalDetections: number;
        detectionRate: number;
    };
    trustSessions: {
        activeSessions: number;
        registeredAgents: number;
        totalNegotiations: number;
    };
    meta: ChartMetaEnvelope;
    emptyReason?: string;
    /** When the selected window is empty but older history exists */
    historyOutsideWindow?: number;
    suggestedWindow?: DashboardWindow;
    windowLabel?: string;
};
export declare function buildAgenticDashboardSummary(db: IDatabase | null, container: Container | null, tenantId: string | undefined, windowDaysInput: number | string): Promise<AgenticDashboardSummary>;
//# sourceMappingURL=agentic-dashboard-summary.d.ts.map