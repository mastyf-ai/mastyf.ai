#!/usr/bin/env npx tsx
/**
 * Load test: concurrent in-process policy evaluations (tools/call decision path).
 *
 * Simulates N concurrent evaluateAsync calls without a live external MCP server.
 *
 * SLO targets (concurrent burst, in-process policy only):
 *   - Correctness: 100% expected pass/block decisions (10% blocked on `eval`)
 *   - p95 per-eval latency < 500ms (CONCURRENT_P95_SLO_MS)
 *   - p99 per-eval latency < 1000ms (CONCURRENT_P99_SLO_MS)
 *   - Zero evaluation errors
 *
 * Usage:
 *   pnpm exec tsx benchmarks/concurrent-tool-calls.ts [concurrency]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { hostname, platform, arch, cpus } from 'os';
import { PolicyEngine } from '../src/policy/policy-engine.js';
import type { CallContext, PolicyConfig } from '../src/policy/policy-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');
const RESULT_JSON = resolve(RESULTS_DIR, 'concurrent-tool-calls-latest.json');

const CONCURRENCY = parseInt(
  process.argv.find((a) => /^\d+$/.test(a)) || process.env.CONCURRENT_TOOL_CALLS || '1000',
  10,
);
const P95_SLO_MS = Number(process.env.CONCURRENT_P95_SLO_MS ?? 500);
const P99_SLO_MS = Number(process.env.CONCURRENT_P99_SLO_MS ?? 1000);
const STRICT = process.env.BENCH_STRICT !== 'false';

const policy: PolicyConfig = {
  policy: {
    mode: 'block',
    rules: [{ name: 'deny-eval', action: 'block', tools: { deny: ['eval'] } }],
    default_action: 'pass',
  },
};

const engine = new PolicyEngine(policy);

function makeContext(i: number): CallContext {
  return {
    serverName: 'bench',
    toolName: i % 10 === 0 ? 'eval' : 'read_file',
    arguments: { path: `/tmp/f${i}.txt` },
    requestId: `req-${i}`,
    requestTokens: 10,
    timestamp: new Date().toISOString(),
  };
}

function expectedAction(i: number): 'block' | 'pass' {
  return i % 10 === 0 ? 'block' : 'pass';
}

function stats(latencies: number[]): { p50: number; p95: number; p99: number; max: number; avg: number } {
  if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    p50: sorted[Math.floor(n * 0.5)] ?? sorted[n - 1],
    p95: sorted[Math.floor(n * 0.95)] ?? sorted[n - 1],
    p99: sorted[Math.floor(n * 0.99)] ?? sorted[n - 1],
    max: sorted[n - 1],
    avg: Math.round((sorted.reduce((s, v) => s + v, 0) / n) * 100) / 100,
  };
}

async function runOne(i: number): Promise<{
  latencyMs: number;
  ok: boolean;
  action?: string;
  error?: string;
}> {
  const want = expectedAction(i);
  const t0 = performance.now();
  try {
    const decision = await engine.evaluateAsync(makeContext(i));
    const latencyMs = performance.now() - t0;
    const ok = decision.action === want;
    return {
      latencyMs,
      ok,
      action: decision.action,
      error: ok ? undefined : `expected ${want}, got ${decision.action}`,
    };
  } catch (err) {
    return {
      latencyMs: performance.now() - t0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const wallStart = Date.now();
  const outcomes = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => runOne(i)));
  const wallMs = Date.now() - wallStart;

  const latencies = outcomes.map((o) => o.latencyMs);
  const latencyStats = stats(latencies);
  const passed = outcomes.filter((o) => o.ok).length;
  const failed = CONCURRENCY - passed;
  const errors = outcomes.filter((o) => o.error).map((o) => o.error!);
  let expectedBlocked = 0;
  let blocked = 0;
  let allowed = 0;
  for (let i = 0; i < CONCURRENCY; i++) {
    if (i % 10 === 0) expectedBlocked++;
    if (outcomes[i].action === 'block') blocked++;
    if (outcomes[i].action === 'pass') allowed++;
  }

  const correctnessPct = Math.round((passed / CONCURRENCY) * 10000) / 100;
  const sloResults = {
    p95Ms: P95_SLO_MS,
    p99Ms: P99_SLO_MS,
    p95Pass: latencyStats.p95 <= P95_SLO_MS,
    p99Pass: latencyStats.p99 <= P99_SLO_MS,
    correctnessPass: failed === 0,
    overallPass: false as boolean,
  };
  sloResults.overallPass = sloResults.correctnessPass && sloResults.p95Pass && sloResults.p99Pass;

  const report = {
    timestamp: new Date().toISOString(),
    configuration: {
      concurrency: CONCURRENCY,
      achievedConcurrent: CONCURRENCY,
      test: 'in-process PolicyEngine.evaluateAsync (deny eval when i%10===0)',
      slo: { p95Ms: P95_SLO_MS, p99Ms: P99_SLO_MS },
    },
    correctness: {
      total: CONCURRENCY,
      passed,
      failed,
      correctnessPct,
      expectedBlocked,
      blocked,
      allowed,
    },
    latencyMs: latencyStats,
    throughput: {
      wallMs,
      evaluationsPerSecond: wallMs > 0 ? Math.round((CONCURRENCY / wallMs) * 1000) : 0,
    },
    sloResults,
    errors: errors.slice(0, 20),
    machine: {
      hostname: hostname(),
      platform: `${platform()} ${arch()}`,
      cpuCount: cpus().length,
      node: process.version,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(RESULT_JSON, JSON.stringify(report, null, 2) + '\n');

  if (STRICT && !sloResults.overallPass) {
    const reasons: string[] = [];
    if (!sloResults.correctnessPass) reasons.push(`correctness ${correctnessPct}% (${failed} failures)`);
    if (!sloResults.p95Pass) reasons.push(`p95 ${latencyStats.p95}ms > ${P95_SLO_MS}ms`);
    if (!sloResults.p99Pass) reasons.push(`p99 ${latencyStats.p99}ms > ${P99_SLO_MS}ms`);
    console.error(`SLO FAILED: ${reasons.join('; ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
