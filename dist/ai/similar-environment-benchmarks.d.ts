import type { ProxyCallRecord } from '../types.js';
export interface SimilarEnvironmentBenchmark {
    serverName: string;
    totalCalls: number;
    blockedRate: number;
    avgLatencyMs: number;
    avgTokens: number;
    peerBlockedRateP50: number;
    peerBlockedRateP90: number;
    peerLatencyP50: number;
    peerLatencyP90: number;
    status: 'outperforming' | 'neutral' | 'needs_attention';
}
export declare function buildSimilarEnvironmentBenchmarks(records: ProxyCallRecord[]): SimilarEnvironmentBenchmark[];
//# sourceMappingURL=similar-environment-benchmarks.d.ts.map