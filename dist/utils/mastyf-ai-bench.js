/**
 * Mastyf AI Benchmark — scorecard from adversarial harness and security-swarm reports.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
function loadJson(path) {
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function runMastyfAiBenchScorecard(reportsDir = join(process.cwd(), 'reports'), profile = 'default') {
    const sources = [];
    let blockRate = 0;
    let falsePositiveRate = 0;
    let p95LatencyMs;
    let corpusEntries;
    let parityAgreement;
    let harnessPassed;
    const harnessResults = loadJson(join(reportsDir, 'adversarial-harness', 'results.json'));
    if (harnessResults) {
        sources.push('reports/adversarial-harness/results.json');
        const corpus = harnessResults.corpus;
        if (corpus) {
            blockRate = corpus.recall ?? corpus.attacksBlocked / Math.max(corpus.attacksTotal ?? 1, 1);
            falsePositiveRate = 1 - (corpus.benignPassRate ?? 1);
            corpusEntries = corpus.totalEntries;
        }
        const parity = harnessResults.parity;
        if (parity)
            parityAgreement = parity.agreementRate;
        harnessPassed = Boolean(harnessResults.overallPassed);
        const latency = harnessResults.nodeIntegration?.concurrency;
        p95LatencyMs = latency?.p95Ms ??
            (latency?.proxy?.p95Ms);
    }
    const swarm = loadJson(join(reportsDir, 'security-swarm', 'latest.json'));
    if (swarm) {
        sources.push('reports/security-swarm/latest.json');
        const corpus = swarm.corpus;
        if (corpus) {
            blockRate = corpus.attackBlockRate ?? blockRate;
            falsePositiveRate = 1 - (corpus.benignPassRate ?? 1);
            corpusEntries = corpus.totalEntries ?? corpusEntries;
        }
        const parity = swarm.parity;
        if (parity)
            parityAgreement = parity.agreementRate ?? parityAgreement;
        harnessPassed = swarm.harness?.allOk ?? harnessPassed;
    }
    const harnessSummary = loadJson(join(process.cwd(), 'adversarial-harness', 'reports', 'harness-summary.json'));
    if (harnessSummary) {
        sources.push('adversarial-harness/reports/harness-summary.json');
        harnessPassed = Boolean(harnessSummary.allOk ?? harnessPassed);
    }
    return {
        profile,
        generatedAt: new Date().toISOString(),
        blockRate: Math.round(blockRate * 1000) / 1000,
        falsePositiveRate: Math.round(falsePositiveRate * 1000) / 1000,
        p95LatencyMs,
        corpusEntries,
        parityAgreement,
        harnessPassed,
        sources,
        summary: `Block rate ${(blockRate * 100).toFixed(1)}%, FP rate ${(falsePositiveRate * 100).toFixed(1)}% from ${sources.length} report(s)`,
    };
}
export function persistBenchmarkScorecard(store, scorecard, packageName) {
    store.saveBenchmarkSubmission({
        id: `bench-${Date.now()}`,
        profile: scorecard.profile,
        packageName,
        blockRate: scorecard.blockRate,
        falsePositiveRate: scorecard.falsePositiveRate,
        p95LatencyMs: scorecard.p95LatencyMs,
        scorecardJson: JSON.stringify(scorecard),
        submittedAt: scorecard.generatedAt,
    });
}
/** Optionally run adversarial harness before scoring (MASTYF_AI_BENCH_RUN_HARNESS=true). */
export async function runHarnessThenScorecard(reportsDir = join(process.cwd(), 'reports'), profile = 'default') {
    if (process.env.MASTYF_AI_BENCH_RUN_HARNESS === 'true') {
        const { spawnSync } = await import('child_process');
        const result = spawnSync('node', ['adversarial-harness/run-harness.mjs'], {
            cwd: process.cwd(),
            stdio: 'inherit',
            env: { ...process.env, MASTYF_AI_REPORTS_DIR: reportsDir },
        });
        if (result.status !== 0) {
            throw new Error(`Harness exited with code ${result.status ?? 'unknown'}`);
        }
    }
    return runMastyfAiBenchScorecard(reportsDir, profile);
}
//# sourceMappingURL=mastyf-ai-bench.js.map