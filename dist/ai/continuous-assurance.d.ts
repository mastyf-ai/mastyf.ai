import type { ProxyCallRecord } from '../types.js';
import type { AutopilotStatus } from '../utils/autopilot-status.js';
import type { SimilarEnvironmentBenchmark } from './similar-environment-benchmarks.js';
export interface ContinuousAssuranceReport {
    generatedAt: string;
    tenantId: string;
    controls: {
        trafficProtected: boolean;
        llmReachable: boolean;
        pendingSuggestions: number;
        threatResearchQueue: number;
    };
    metrics: {
        totalCalls: number;
        blockedCalls: number;
        blockedRate: number;
        avgLatencyMs: number;
    };
    benchmarkSummary: {
        servers: number;
        needsAttention: number;
        outperforming: number;
    };
    attestations: string[];
}
export declare function buildContinuousAssuranceReport(input: {
    tenantId: string;
    records: ProxyCallRecord[];
    autopilot: AutopilotStatus;
    benchmarks: SimilarEnvironmentBenchmark[];
}): ContinuousAssuranceReport;
//# sourceMappingURL=continuous-assurance.d.ts.map