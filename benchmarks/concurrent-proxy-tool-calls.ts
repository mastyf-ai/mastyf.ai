#!/usr/bin/env npx tsx
/**
 * Load test: 1000 concurrent tools/call through in-process McpProxyServer + echo fixture.
 *
 * Compares full proxy path (policy + stdio upstream) vs policy-only concurrent-tool-calls.ts.
 *
 * SLO targets (concurrent burst, full proxy path):
 *   - Correctness: 100% expected pass/block (10% blocked on `eval`)
 *   - p95 per-call latency < CONCURRENT_PROXY_P95_SLO_MS (default 5000)
 *   - p99 per-call latency < CONCURRENT_PROXY_P99_SLO_MS (default 10000)
 *   - Zero request errors / timeouts
 *
 * Note: sequential proxy SLO in benchmarks/run.ts uses 150ms p95 (CI gate); concurrent
 * load is expected to be much slower — use env overrides to tune gates.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/concurrent-proxy-tool-calls.ts [concurrency]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { hostname, platform, arch, cpus } from 'os';
import { McpProxyServer } from '../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../src/database/history-db.js';
import { PolicyEngine } from '../src/policy/policy-engine.js';
import type { PolicyConfig } from '../src/policy/policy-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');
const RESULT_JSON = resolve(RESULTS_DIR, 'concurrent-proxy-tool-calls-latest.json');
const SUMMARY_MD = resolve(RESULTS_DIR, 'concurrent-proxy-tool-calls-summary.md');
const ECHO_SERVER = resolve(__dirname, 'fixtures', 'echo-server.cjs');

const CONCURRENCY = parseInt(
  process.argv.find((a) => /^\d+$/.test(a)) || process.env.CONCURRENT_TOOL_CALLS || '1000',
  10,
);
const P95_SLO_MS = Number(process.env.CONCURRENT_PROXY_P95_SLO_MS ?? 5000);
const P99_SLO_MS = Number(process.env.CONCURRENT_PROXY_P99_SLO_MS ?? 10000);
const RESPONSE_TIMEOUT_MS = Number(process.env.CONCURRENT_PROXY_TIMEOUT_MS ?? 60000);
const STRICT = process.env.BENCH_STRICT !== 'false';

const POLICY: PolicyConfig = {
  version: '1.0',
  policy: {
    mode: 'block',
    rules: [{ name: 'deny-eval', action: 'block', tools: { deny: ['eval'] } }],
    default_action: 'pass',
  },
};

type PendingEntry = {
  resolve: (msg: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  startMs: number;
};

function createCall(id: number, tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: String(id),
    method: 'tools/call',
    params: { name: tool, arguments: args },
  });
}

function createInitialize(id: number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: String(id),
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'concurrent-proxy-bench', version: '1.0' },
    },
  });
}

function expectedBlocked(i: number): boolean {
  return i % 10 === 0;
}

function toolForIndex(i: number): string {
  return expectedBlocked(i) ? 'eval' : 'search';
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

function checkOutcome(i: number, msg: Record<string, unknown>): { ok: boolean; blocked: boolean; error?: string } {
  const wantBlocked = expectedBlocked(i);
  const hasError = msg.error != null;
  const blocked = hasError && (msg.error as { code?: number }).code === -32001;

  if (wantBlocked) {
    if (!blocked) {
      return { ok: false, blocked: false, error: `expected policy block, got ${hasError ? 'other error' : 'pass'}` };
    }
    return { ok: true, blocked: true };
  }

  if (hasError) {
    return {
      ok: false,
      blocked: false,
      error: `expected pass, got error: ${(msg.error as { message?: string }).message ?? 'unknown'}`,
    };
  }
  if (!msg.result) {
    return { ok: false, blocked: false, error: 'expected result, got empty response' };
  }
  return { ok: true, blocked: false };
}

function writeSummaryMd(report: Record<string, unknown>): void {
  const cfg = report.configuration as Record<string, unknown>;
  const slo = report.sloResults as Record<string, unknown>;
  const lat = report.latencyMs as Record<string, number>;
  const corr = report.correctness as Record<string, number>;
  const thr = report.throughput as Record<string, number>;
  const machine = report.machine as Record<string, unknown>;

  const md = `# Concurrent proxy tool calls benchmark

**Run:** ${report.timestamp}  
**Command:** \`pnpm exec tsx benchmarks/concurrent-proxy-tool-calls.ts\`

## Configuration

| Setting | Value |
|---------|--------|
| Concurrency | **${cfg.concurrency}** (achieved ${cfg.achievedConcurrent} simultaneous \`tools/call\` via proxy) |
| Workload | In-process \`McpProxyServer\` → echo fixture (\`${ECHO_SERVER}\`) |
| Policy | Block \`eval\`; pass \`search\` |
| Traffic mix | Indices \`i % 10 === 0\` → \`eval\` (expect block); else \`search\` (expect pass) |

## Correctness

| Metric | Result |
|--------|--------|
| Total calls | ${corr.total} |
| Passed (expected outcome) | **${corr.passed}** |
| Failed | **${corr.failed}** |
| Correctness | **${corr.correctnessPct}%** |
| Blocked (eval) | ${corr.blocked} / ${corr.expectedBlocked} expected |
| Allowed (search) | ${corr.allowed} / ${corr.expectedAllowed} expected |
| Timeouts | ${corr.timeouts} |

## Latency (per tools/call RTT through proxy, ms)

| Percentile | ms |
|------------|-----|
| p50 | ~${lat.p50.toFixed(1)} |
| p95 | ~${lat.p95.toFixed(1)} |
| p99 | ~${lat.p99.toFixed(1)} |
| max | ~${lat.max.toFixed(1)} |
| avg | ~${lat.avg.toFixed(1)} |

**Wall clock:** ${thr.wallMs} ms total (~${thr.callsPerSecond} calls/s for the burst).

## SLO pass/fail

| SLO | Target | Measured | Status |
|-----|--------|----------|--------|
| Correctness | 100% expected decisions | ${corr.correctnessPct}% | **${slo.correctnessPass ? 'PASS' : 'FAIL'}** |
| p95 latency | < ${slo.p95Ms} ms | ~${lat.p95.toFixed(1)} ms | **${slo.p95Pass ? 'PASS' : 'FAIL'}** |
| p99 latency | < ${slo.p99Ms} ms | ~${lat.p99.toFixed(1)} ms | **${slo.p99Pass ? 'PASS' : 'FAIL'}** |
| **Overall** | | | **${slo.overallPass ? 'PASS' : 'FAIL'}** |

SLO env overrides: \`CONCURRENT_PROXY_P95_SLO_MS\` (default 5000), \`CONCURRENT_PROXY_P99_SLO_MS\` (default 10000).

Sequential proxy CI gate (\`benchmarks/run.ts\`): p95 **150 ms** — not applicable to this concurrent burst.

## Machine notes

- ${machine.platform}, ${machine.cpuCount} CPUs, Node ${machine.node}
- Host: ${machine.hostname}

## Artifacts

- JSON: \`benchmarks/results/concurrent-proxy-tool-calls-latest.json\`
`;

  writeFileSync(SUMMARY_MD, md);
}

async function main(): Promise<void> {
  const db = new HistoryDatabase(':memory:');
  const policyEngine = new PolicyEngine(POLICY);
  const proxy = new McpProxyServer('node', [ECHO_SERVER], {}, db, 'concurrent-proxy-bench', policyEngine);

  const pending = new Map<string, PendingEntry>();
  const origStdout = process.stdout.write.bind(process.stdout);

  process.stdout.write = function (chunk: unknown, ...args: unknown[]): boolean {
    try {
      const msg = JSON.parse(String(chunk)) as Record<string, unknown>;
      const id = msg.id != null ? String(msg.id) : null;
      if (id && pending.has(id)) {
        const entry = pending.get(id)!;
        pending.delete(id);
        entry.resolve(msg);
      }
    } catch {
      // non-JSON stdout — ignore
    }
    return origStdout(chunk as Buffer, ...(args as Parameters<typeof process.stdout.write>));
  };

  await new Promise((r) => setTimeout(r, 300));

  const initId = '0';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('initialize timeout')), 10000);
    pending.set(initId, {
      startMs: performance.now(),
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    void proxy.handleClientInput(createInitialize(0));
  });
  pending.delete(initId);

  await new Promise((r) => setTimeout(r, 200));

  async function runOne(i: number): Promise<{
    latencyMs: number;
    ok: boolean;
    blocked: boolean;
    error?: string;
    timeout?: boolean;
  }> {
    const id = String(i);
    const tool = toolForIndex(i);
    const raw = createCall(i, tool, { query: `bench-${i}`, path: `/tmp/f${i}.txt` });

    const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout after ${RESPONSE_TIMEOUT_MS}ms`));
      }, RESPONSE_TIMEOUT_MS);
      pending.set(id, {
        startMs: performance.now(),
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });

    const t0 = performance.now();
    try {
      await proxy.handleClientInput(raw);
      const msg = await responsePromise;
      const latencyMs = performance.now() - t0;
      const outcome = checkOutcome(i, msg);
      return { latencyMs, ok: outcome.ok, blocked: outcome.blocked, error: outcome.error };
    } catch (err) {
      pending.delete(id);
      return {
        latencyMs: performance.now() - t0,
        ok: false,
        blocked: false,
        error: err instanceof Error ? err.message : String(err),
        timeout: err instanceof Error && err.message.includes('timeout'),
      };
    }
  }

  const wallStart = Date.now();
  const outcomes = await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => runOne(i)));
  const wallMs = Date.now() - wallStart;

  process.stdout.write = origStdout;
  proxy.kill();
  db.close();

  const latencies = outcomes.map((o) => o.latencyMs);
  const latencyStats = stats(latencies);
  const passed = outcomes.filter((o) => o.ok).length;
  const failed = CONCURRENCY - passed;
  const timeouts = outcomes.filter((o) => o.timeout).length;
  const errors = outcomes.filter((o) => o.error).map((o) => o.error!);

  let expectedBlockedCount = 0;
  let blocked = 0;
  let allowed = 0;
  const expectedAllowed = CONCURRENCY - Math.floor(CONCURRENCY / 10);
  for (let i = 0; i < CONCURRENCY; i++) {
    if (expectedBlocked(i)) expectedBlockedCount++;
    if (outcomes[i].blocked) blocked++;
    if (outcomes[i].ok && !outcomes[i].blocked) allowed++;
  }

  const correctnessPct = Math.round((passed / CONCURRENCY) * 10000) / 100;
  const sloResults = {
    p95Ms: P95_SLO_MS,
    p99Ms: P99_SLO_MS,
    p95Pass: latencyStats.p95 <= P95_SLO_MS,
    p99Pass: latencyStats.p99 <= P99_SLO_MS,
    correctnessPass: failed === 0 && timeouts === 0,
    overallPass: false as boolean,
  };
  sloResults.overallPass = sloResults.correctnessPass && sloResults.p95Pass && sloResults.p99Pass;

  const report = {
    timestamp: new Date().toISOString(),
    configuration: {
      concurrency: CONCURRENCY,
      achievedConcurrent: CONCURRENCY,
      test: 'in-process McpProxyServer + echo-server (deny eval when i%10===0)',
      echoServer: ECHO_SERVER,
      slo: { p95Ms: P95_SLO_MS, p99Ms: P99_SLO_MS },
      sequentialProxyP95GateMs: 150,
    },
    correctness: {
      total: CONCURRENCY,
      passed,
      failed,
      correctnessPct,
      expectedBlocked: expectedBlockedCount,
      blocked,
      expectedAllowed,
      allowed,
      timeouts,
    },
    latencyMs: latencyStats,
    throughput: {
      wallMs,
      callsPerSecond: wallMs > 0 ? Math.round((CONCURRENCY / wallMs) * 1000) : 0,
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
  writeSummaryMd(report);

  if (STRICT && !sloResults.overallPass) {
    const reasons: string[] = [];
    if (!sloResults.correctnessPass) {
      reasons.push(`correctness ${correctnessPct}% (${failed} failures, ${timeouts} timeouts)`);
    }
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
