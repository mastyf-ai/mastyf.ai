/**
 * Benchmark: Industry-standard roadmap plan compliance audit runtime.
 *
 * Run: pnpm tsx benchmarks/plan-compliance-audit.ts
 */
import { runPlanComplianceAudit } from '../src/agentic/plan-compliance-audit.js';

async function benchmark(): Promise<void> {
  console.log('=== Plan Compliance Audit Benchmark ===\n');

  const runs = 5;
  const times: number[] = [];
  let lastReport: Awaited<ReturnType<typeof runPlanComplianceAudit>> | null = null;

  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    lastReport = await runPlanComplianceAudit();
    times.push(performance.now() - t0);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  console.log(`Runs: ${runs}`);
  console.log(`Avg: ${avg.toFixed(1)}ms | Min: ${min.toFixed(1)}ms | Max: ${max.toFixed(1)}ms`);
  if (lastReport) {
    console.log(`Overall score: ${lastReport.overallScore}%`);
    console.log(`Production ready: ${lastReport.productionReady}`);
    console.log('Module scores:', lastReport.modules.map(m => `${m.id}=${m.score}%`).join(', '));
  }
}

benchmark().catch(err => {
  console.error(err);
  process.exit(1);
});
