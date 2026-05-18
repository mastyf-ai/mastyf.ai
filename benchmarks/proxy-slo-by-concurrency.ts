#!/usr/bin/env npx tsx
/**
 * Realistic proxy SLO sweep: N in-flight tools/call per tier through McpProxyServer + echo.
 *
 * Default tiers: 1, 10, 25, 50 (env BENCH_PROXY_CONCURRENCY_TIERS).
 * Tiered p95 gates (see PROXY_TIER_P95_SLO_MS in lib/proxy-bench-common.ts).
 *
 * Usage:
 *   pnpm benchmark:proxy-tiers
 *   LOG_LEVEL=error BENCH_PROXY_CONCURRENCY_TIERS=1,10 pnpm benchmark:proxy-tiers
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { hostname, platform, arch, cpus } from 'os';
import {
  ECHO_SERVER,
  PROXY_TIER_P95_SLO_MS,
  ProxyBenchSession,
  parseConcurrencyList,
  summarizeOutcomes,
} from './lib/proxy-bench-common.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');
const RESULT_JSON = resolve(RESULTS_DIR, 'proxy-slo-by-concurrency-latest.json');
const SUMMARY_MD = resolve(RESULTS_DIR, 'proxy-slo-by-concurrency-summary.md');

const TIERS = parseConcurrencyList();
const STRICT = process.env.BENCH_STRICT !== 'false';

type TierResult = {
  concurrency: number;
  p95SloMs: number;
  correctness: Record<string, number>;
  latencyMs: Record<string, number>;
  throughput: { wallMs: number; callsPerSecond: number };
  sloResults: Record<string, boolean | number>;
  errors: string[];
};

function writeSummaryMd(report: Record<string, unknown>): void {
  const tiers = report.tiers as TierResult[];
  const httpSse = report.httpSseVariant as Record<string, string>;
  const machine = report.machine as Record<string, unknown>;

  const tierRows = tiers
    .map((t) => {
      const slo = t.sloResults;
      const lat = t.latencyMs;
      return `| ${t.concurrency} | ${t.p95SloMs} | ~${lat.p50.toFixed(1)} | ~${lat.p95.toFixed(1)} | ~${lat.p99.toFixed(1)} | ${t.correctness.correctnessPct}% | **${slo.overallPass ? 'PASS' : 'FAIL'}** |`;
    })
    .join('\n');

  const md = `# Proxy SLO by concurrency (tiered deployment gates)

**Run:** ${report.timestamp}  
**Command:** \`pnpm benchmark:proxy-tiers\`

## Tiered SLO table (proxy path)

| Concurrency (in-flight) | p95 gate (ms) | p50 | p95 | p99 | Correctness | Overall |
|-------------------------|---------------|-----|-----|-----|-------------|---------|
${tierRows}

Tiers env: \`BENCH_PROXY_CONCURRENCY_TIERS\` (default \`1,10,25,50\`).

**Guidance:** Use **policy-only** (\`pnpm benchmark:concurrent\`, 1000-way) for rule-tuning latency (p95 &lt; 500 ms). Use **proxy tiers** above for deployment SLOs under realistic in-flight load. Use **proxy 1k burst** (\`pnpm benchmark:concurrent-proxy\`) for worst-case stdio contention.

## Configuration

| Setting | Value |
|---------|--------|
| Workload | In-process \`McpProxyServer\` → echo (\`${ECHO_SERVER}\`) |
| Policy | Block \`eval\`; pass \`search\` |
| Traffic mix | \`i % 10 === 0\` → \`eval\` (block); else \`search\` |

## HTTP/SSE transport variant

| Status | Notes |
|--------|--------|
| **${httpSse.status}** | ${httpSse.reason} |

## Machine

- ${machine.platform}, ${machine.cpuCount} CPUs, Node ${machine.node}
- Host: ${machine.hostname}

## Artifacts

- JSON: \`benchmarks/results/proxy-slo-by-concurrency-latest.json\`
`;

  writeFileSync(SUMMARY_MD, md);
}

async function runTier(concurrency: number): Promise<TierResult> {
  const p95SloMs = PROXY_TIER_P95_SLO_MS[concurrency] ?? Number(process.env.CONCURRENT_PROXY_P95_SLO_MS ?? 5000);
  const session = new ProxyBenchSession({ serverName: `proxy-tier-${concurrency}` });
  await session.start();
  const { outcomes, wallMs } = await session.runConcurrent(concurrency);
  await session.stop();

  const summary = summarizeOutcomes(outcomes, concurrency, p95SloMs);
  const errors = outcomes.filter((o) => o.error).map((o) => o.error!);

  return {
    concurrency,
    p95SloMs,
    correctness: summary.correctness,
    latencyMs: summary.latencyMs,
    throughput: {
      wallMs,
      callsPerSecond: wallMs > 0 ? Math.round((concurrency / wallMs) * 1000) : 0,
    },
    sloResults: summary.sloResults,
    errors: errors.slice(0, 10),
  };
}

async function main(): Promise<void> {
  const tiers: TierResult[] = [];
  for (const concurrency of TIERS) {
    console.error(`[proxy-slo-tiers] running concurrency=${concurrency}...`);
    tiers.push(await runTier(concurrency));
  }

  const allPass = tiers.every((t) => t.sloResults.overallPass);

  const report = {
    timestamp: new Date().toISOString(),
    configuration: {
      tiers: TIERS,
      tieredP95GatesMs: PROXY_TIER_P95_SLO_MS,
      echoServer: ECHO_SERVER,
      policyOnly1kGatesMs: { p95: 500, p99: 1000 },
      concurrentProxy1kGatesMs: { p95: 5000, p99: 10000 },
    },
    tiers,
    overallPass: allPass,
    httpSseVariant: {
      status: 'BLOCKED',
      reason:
        'No local HTTP MCP echo fixture or session bootstrap in-repo; SseProxyServer/HttpProxyServer need live upstream + SSE handshake. Use stdio proxy tiers for deployment SLOs.',
    },
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

  if (STRICT && !allPass) {
    const failed = tiers.filter((t) => !t.sloResults.overallPass);
    console.error(
      `SLO FAILED tiers: ${failed.map((t) => `${t.concurrency} (p95 ${t.latencyMs.p95} > ${t.p95SloMs})`).join(', ')}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
