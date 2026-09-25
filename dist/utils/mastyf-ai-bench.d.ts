import type { IndustryStandardStore } from '../database/industry-standard-store.js';
export interface BenchmarkScorecard {
    profile: string;
    generatedAt: string;
    blockRate: number;
    falsePositiveRate: number;
    p95LatencyMs?: number;
    corpusEntries?: number;
    parityAgreement?: number;
    harnessPassed?: boolean;
    sources: string[];
    summary: string;
}
export declare function runMastyfAiBenchScorecard(reportsDir?: string, profile?: string): BenchmarkScorecard;
export declare function persistBenchmarkScorecard(store: IndustryStandardStore, scorecard: BenchmarkScorecard, packageName?: string): void;
/** Optionally run adversarial harness before scoring (MASTYF_AI_BENCH_RUN_HARNESS=true). */
export declare function runHarnessThenScorecard(reportsDir?: string, profile?: string): Promise<BenchmarkScorecard>;
//# sourceMappingURL=mastyf-ai-bench.d.ts.map