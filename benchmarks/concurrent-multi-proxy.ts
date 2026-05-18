#!/usr/bin/env npx tsx
/**
 * Horizontal scale: K isolated proxy+echo child processes, 1000 total concurrent tools/call.
 *
 * Env:
 *   BENCH_PROXY_REPLICAS (default 10)
 *   BENCH_TOTAL_CALLS (default 1000)
 *
 * Compares aggregate latency to single-proxy 1k burst (concurrent-proxy-tool-calls).
 */
import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { hostname, platform, arch, cpus } from 'os';
import { ECHO_SERVER, stats, type LatencyStats } from './lib/proxy-bench-common.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');
const RESULT_JSON = resolve(RESULTS_DIR, 'concurrent-multi-proxy-latest.json');
const SUMMARY_MD = resolve(RESULTS_DIR, 'concurrent-multi-proxy-summary.md');
const WORKER = resolve(__dirname, 'lib', 'multi-proxy-worker.ts');
const TSX_BIN = resolve(__dirname, '..', 'node_modules', '.bin', 'tsx');
const SINGLE_PROXY_JSON = resolve(RESULTS_DIR, 'concurrent-proxy-tool-calls-latest.json');

const REPLICAS = parseInt(process.env.BENCH_PROXY_REPLICAS ?? '10', 10);
const TOTAL_CALLS = parseInt(process.env.BENCH_TOTAL_CALLS ?? '1000', 10);
const STRICT = process.env.BENCH_STRICT !== 'false';

type WorkerPayload = {
  replicaId: number;
  callCount: number;
  wallMs: number;
  latenciesMs: number[];
  correctness: { passed: number; failed: number; correctnessPct: number; timeouts: number };
  latencyMs: LatencyStats;
};

function runWorker(replicaId: number, callsPerReplica: number, resultDir: string): Promise<WorkerPayload> {
  const resultFile = resolve(resultDir, `replica-${replicaId}.json`);
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(TSX_BIN, [WORKER], {
      env: {
        ...process.env,
        BENCH_REPLICA_ID: String(replicaId),
        BENCH_CALLS_PER_REPLICA: String(callsPerReplica),
        BENCH_WORKER_RESULT_FILE: resultFile,
        LOG_LEVEL: process.env.LOG_LEVEL ?? 'error',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker ${replicaId} exit ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      if (!existsSync(resultFile)) {
        reject(new Error(`worker ${replicaId}: missing result file ${resultFile}`));
        return;
      }
      try {
        resolve(JSON.parse(readFileSync(resultFile, 'utf8')) as WorkerPayload);
      } catch (e) {
        reject(new Error(`worker ${replicaId}: invalid JSON: ${e}`));
      }
    });
  });
}

function loadSingleProxyBaseline(): Record<string, unknown> | null {
  if (!existsSync(SINGLE_PROXY_JSON)) return null;
  try {
    return JSON.parse(readFileSync(SINGLE_PROXY_JSON, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeSummaryMd(report: Record<string, unknown>): void {
  const cfg = report.configuration as Record<string, number>;
  const agg = report.aggregate as Record<string, unknown>;
  const lat = agg.latencyMs as LatencyStats;
  const cmp = report.comparisonToSingleProxy as Record<string, unknown> | null;
  const perReplica = report.perReplica as WorkerPayload[];
  const machine = report.machine as Record<string, unknown>;

  const replicaRows = perReplica
    .map(
      (r) =>
        `| ${r.replicaId} | ${r.callCount} | ${r.correctness.correctnessPct}% | ~${r.latencyMs.p95.toFixed(1)} | ${r.wallMs} |`,
    )
    .join('\n');

  let cmpSection = 'Run `pnpm benchmark:concurrent-proxy` first to populate baseline JSON.\n';
  if (cmp) {
    cmpSection = `| Metric | Single proxy (1k) | Multi-proxy (${cfg.replicas}×${cfg.callsPerReplica}) | Delta (multi − single) |
|--------|-------------------|--------------------------------------------------|-------------------------|
| p50 | ~${(cmp.singleProxy as LatencyStats).p50} ms | ~${lat.p50.toFixed(1)} ms | ${(cmp.delta as { p50: string }).p50} |
| p95 | ~${(cmp.singleProxy as LatencyStats).p95} ms | ~${lat.p95.toFixed(1)} ms | ${(cmp.delta as { p95: string }).p95} |
| p99 | ~${(cmp.singleProxy as LatencyStats).p99} ms | ~${lat.p99.toFixed(1)} ms | ${(cmp.delta as { p99: string }).p99} |
| Wall | ${cmp.singleProxyWallMs} ms | ${agg.wallMs} ms | ${(cmp.delta as { wallMs: string }).wallMs} |

${cmp.interpretation}`;
  }

  const md = `# Concurrent multi-proxy benchmark

**Run:** ${report.timestamp}  
**Command:** \`pnpm benchmark:multi-proxy\`

## Configuration

| Setting | Value |
|---------|--------|
| Replicas (K) | **${cfg.replicas}** |
| Total calls | **${cfg.totalCalls}** |
| Calls per replica | **${cfg.callsPerReplica}** |
| Workload | K forked workers → each \`McpProxyServer\` + echo |

## Aggregate (global)

| Metric | Value |
|--------|--------|
| Correctness | **${(agg.correctness as { correctnessPct: number }).correctnessPct}%** |
| p50 | ~${lat.p50.toFixed(1)} ms |
| p95 | ~${lat.p95.toFixed(1)} ms |
| p99 | ~${lat.p99.toFixed(1)} ms |
| Wall | ${agg.wallMs} ms |

## Per-replica

| Replica | Calls | Correctness | p95 | Wall (ms) |
|---------|-------|-------------|-----|-----------|
${replicaRows}

## vs single-proxy 1k burst

${cmpSection}

## Guidance

- **Policy-only** (\`benchmark:concurrent\`): rule tuning, 1000-way in-process policy.
- **Proxy tiers** (\`benchmark:proxy-tiers\`): deployment SLOs at 1–50 in-flight.
- **Multi-replica**: stdio serialization bottleneck; lower tail latency when sharded across K processes.

## Machine

- ${machine.platform}, ${machine.cpuCount} CPUs, Node ${machine.node}

## Artifacts

- JSON: \`benchmarks/results/concurrent-multi-proxy-latest.json\`
`;

  writeFileSync(SUMMARY_MD, md);
}

async function main(): Promise<void> {
  if (TOTAL_CALLS % REPLICAS !== 0) {
    console.error(`BENCH_TOTAL_CALLS (${TOTAL_CALLS}) must be divisible by BENCH_PROXY_REPLICAS (${REPLICAS})`);
    process.exit(1);
  }
  const callsPerReplica = TOTAL_CALLS / REPLICAS;

  console.error(`[multi-proxy] ${REPLICAS} replicas × ${callsPerReplica} calls = ${TOTAL_CALLS} total`);
  const resultDir = mkdtempSync(resolve(tmpdir(), 'mcp-guardian-multi-proxy-'));
  const wallStart = Date.now();
  let perReplica: WorkerPayload[];
  try {
    perReplica = await Promise.all(
      Array.from({ length: REPLICAS }, (_, i) => runWorker(i, callsPerReplica, resultDir)),
    );
  } finally {
    try {
      rmSync(resultDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  const wallMs = Date.now() - wallStart;

  const allLatencies = perReplica.flatMap((r) => r.latenciesMs);
  const latencyMs = stats(allLatencies);
  const passed = perReplica.reduce((s, r) => s + r.correctness.passed, 0);
  const failed = perReplica.reduce((s, r) => s + r.correctness.failed, 0);
  const timeouts = perReplica.reduce((s, r) => s + (r.correctness.timeouts ?? 0), 0);
  const correctnessPct = TOTAL_CALLS > 0 ? Math.round((passed / TOTAL_CALLS) * 10000) / 100 : 0;

  const singleBaseline = loadSingleProxyBaseline();
  let comparisonToSingleProxy: Record<string, unknown> | null = null;
  if (singleBaseline?.latencyMs) {
    const singleLat = singleBaseline.latencyMs as LatencyStats;
    const singleWall = (singleBaseline.throughput as { wallMs?: number })?.wallMs ?? null;
    const deltaP95 = latencyMs.p95 - singleLat.p95;
    comparisonToSingleProxy = {
      singleProxy: singleLat,
      singleProxyWallMs: singleWall,
      multiProxy: latencyMs,
      multiProxyWallMs: wallMs,
      delta: {
        p50: `${(latencyMs.p50 - singleLat.p50).toFixed(1)} ms`,
        p95: `${deltaP95.toFixed(1)} ms`,
        p99: `${(latencyMs.p99 - singleLat.p99).toFixed(1)} ms`,
        wallMs: singleWall != null ? `${wallMs - singleWall} ms` : 'n/a',
      },
      tailImproved: deltaP95 < 0,
      interpretation:
        deltaP95 < 0
          ? 'Multi-replica sharding reduced global p95 vs single-proxy 1k burst (stdio bottleneck).'
          : 'Multi-replica did not beat single-proxy p95 on this run; try higher K or check machine load.',
    };
  }

  const report = {
    timestamp: new Date().toISOString(),
    configuration: {
      replicas: REPLICAS,
      totalCalls: TOTAL_CALLS,
      callsPerReplica,
      echoServer: ECHO_SERVER,
      workerScript: WORKER,
    },
    perReplica,
    aggregate: {
      correctness: { total: TOTAL_CALLS, passed, failed, correctnessPct, timeouts },
      latencyMs,
      wallMs,
      callsPerSecond: wallMs > 0 ? Math.round((TOTAL_CALLS / wallMs) * 1000) : 0,
    },
    comparisonToSingleProxy,
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

  if (STRICT && (failed > 0 || timeouts > 0)) {
    console.error(`Correctness FAILED: ${failed} failures, ${timeouts} timeouts`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
