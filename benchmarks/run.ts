#!/usr/bin/env npx tsx
/**
 * MCP Guardian Performance Benchmarks
 *
 * Measures proxy overhead across three scenarios:
 * 1. Baseline — direct MCP server RTT (no proxy)
 * 2. Passthrough — proxy with zero policy rules
 * 3. Policy enforced — proxy with blocking rules active
 *
 * Each scenario runs 1000 tools/call round-trips and reports p50/p95/p99 per-call latency.
 */
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { McpProxyServer } from '../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../src/database/history-db.js';
import { PolicyEngine } from '../src/policy/policy-engine.js';
import { PolicyConfig } from '../src/policy/policy-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = resolve(__dirname, 'fixtures', 'echo-server.cjs');
const ITERATIONS = 1000;
const WARMUP = 50;

// ── Shared policy configs ──────────────────────────────────────────
const NOOP_POLICY: PolicyConfig = {
  version: '1.0',
  policy: { mode: 'audit', rules: [] },
};

const BLOCKING_POLICY: PolicyConfig = {
  version: '1.0',
  policy: {
    mode: 'block',
    rules: [
      { name: 'shell-injection', action: 'block', patterns: ['rm\\s+-rf', 'curl\\s|wget\\s', ';\\s*\\w'] },
      { name: 'deny-eval', action: 'block', tools: { deny: ['eval', 'execute_command'] } },
      { name: 'rate-limit', action: 'flag', maxCallsPerMinute: 60 },
    ],
  },
};

// ── Helpers ─────────────────────────────────────────────────────────
function createEchoCall(id: number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: String(id),
    method: 'tools/call',
    params: {
      name: 'search',
      arguments: { query: `benchmark query ${id}` },
    },
  }) + '\n';
}

function createInitializeCall(id: number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: String(id),
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'bench', version: '1.0' },
    },
  }) + '\n';
}

function stats(latencies: number[]): { p50: number; p95: number; p99: number; avg: number } {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
    avg: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length * 100) / 100,
  };
}

// ── Direct MCP Server Benchmark (no proxy) ──────────────────────────
async function benchmarkBaseline(): Promise<number[]> {
  const child = spawn('node', [SERVER_PATH], { stdio: ['pipe', 'pipe', 'ignore'] });
  const rl = createInterface({ input: child.stdout! });
  const latencies: number[] = [];
  let pending = new Map<string, number>();

  rl.on('line', (line: string) => {
    try {
      const msg = JSON.parse(line);
      const start = pending.get(String(msg.id));
      if (start !== undefined) {
        latencies.push(Date.now() - start);
        pending.delete(String(msg.id));
      }
    } catch {}
  });

  // Initialize
  child.stdin!.write(createInitializeCall(0));
  await new Promise(r => setTimeout(r, 200));

  // Warmup
  for (let i = 1; i <= WARMUP; i++) {
    pending.set(String(i), Date.now());
    child.stdin!.write(createEchoCall(i));
  }
  await new Promise(r => setTimeout(r, 500));

  // Discard warmup latencies before measurement
  latencies.length = 0;

  // Measurement
  for (let i = WARMUP + 1; i <= WARMUP + ITERATIONS; i++) {
    pending.set(String(i), Date.now());
    child.stdin!.write(createEchoCall(i));
  }

  // Wait for all responses
  while (pending.size > 0) {
    await new Promise(r => setTimeout(r, 10));
  }

  child.kill();
  return latencies;
}

// ── Proxy Benchmark ─────────────────────────────────────────────────
async function benchmarkProxy(policyConfig?: PolicyConfig): Promise<number[]> {
  const db = new HistoryDatabase();
  let policyEngine: PolicyEngine | undefined;
  if (policyConfig) policyEngine = new PolicyEngine(policyConfig);

  const proxy = new McpProxyServer('node', [SERVER_PATH], {}, db, 'bench-echo', policyEngine);
  const latencies: number[] = [];
  let pending = new Map<string, number>();

  // Capture stdout (proxy forwards server responses to process.stdout)
  const origStdout = process.stdout.write.bind(process.stdout);
  process.stdout.write = function(chunk: any, ...args: any[]): boolean {
    try {
      const msg = JSON.parse(String(chunk));
      const start = pending.get(String(msg.id));
      if (start !== undefined) {
        latencies.push(Date.now() - start);
        pending.delete(String(msg.id));
      }
    } catch {}
    return origStdout(chunk, ...args);
  };

  // Wait for proxy startup
  await new Promise(r => setTimeout(r, 300));

  // Initialize proxy (matching baseline)
  proxy.handleClientInput(createInitializeCall(0).trim());
  await new Promise(r => setTimeout(r, 200));

  // Warmup through proxy
  for (let i = 1; i <= WARMUP; i++) {
    pending.set(String(i), Date.now());
    proxy.handleClientInput(createEchoCall(i).trim());
  }
  await new Promise(r => setTimeout(r, 500));

  // Discard warmup latencies before measurement
  latencies.length = 0;

  // Measurement through proxy
  for (let i = WARMUP + 1; i <= WARMUP + ITERATIONS; i++) {
    pending.set(String(i), Date.now());
    proxy.handleClientInput(createEchoCall(i).trim());
  }

  // Wait for all responses
  while (pending.size > 0) {
    await new Promise(r => setTimeout(r, 10));
  }

  process.stdout.write = origStdout;
  proxy.kill();
  db.close();
  return latencies;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('MCP Guardian Performance Benchmarks');
  console.log('====================================');
  console.log(`Iterations per scenario: ${ITERATIONS} (warmup: ${WARMUP})`);
  console.log(`Echo server: ${SERVER_PATH}\n`);

  // 1. Baseline
  console.log('Running baseline (direct MCP server, no proxy)...');
  const baselineLatencies = await benchmarkBaseline();
  const baselineStats = stats(baselineLatencies);
  console.log(`  p50: ${baselineStats.p50}ms | p95: ${baselineStats.p95}ms | p99: ${baselineStats.p99}ms | avg: ${baselineStats.avg}ms`);

  // 2. Proxy passthrough (no policy)
  console.log('Running proxy passthrough (policy: none)...');
  const passthroughLatencies = await benchmarkProxy(undefined);
  const passthroughStats = stats(passthroughLatencies);
  console.log(`  p50: ${passthroughStats.p50}ms | p95: ${passthroughStats.p95}ms | p99: ${passthroughStats.p99}ms | avg: ${passthroughStats.avg}ms`);

  // 3. Proxy with blocking policy
  console.log('Running proxy with blocking policy (3 rules)...');
  const blockingLatencies = await benchmarkProxy(BLOCKING_POLICY);
  const blockingStats = stats(blockingLatencies);
  console.log(`  p50: ${blockingStats.p50}ms | p95: ${blockingStats.p95}ms | p99: ${blockingStats.p99}ms | avg: ${blockingStats.avg}ms`);

  // ── Summary ──────────────────────────────────────────────────────
  const overheadNoPolicy = Math.round((passthroughStats.avg - baselineStats.avg) * 100) / 100;
  const overheadWithPolicy = Math.round((blockingStats.avg - baselineStats.avg) * 100) / 100;

  console.log('\n--- Results ---');
  console.log('| Scenario | p50 | p95 | p99 | Avg | Overhead vs Baseline |');
  console.log('|----------|-----|-----|-----|-----|---------------------|');
  console.log(`| Baseline (no proxy) | ${baselineStats.p50}ms | ${baselineStats.p95}ms | ${baselineStats.p99}ms | ${baselineStats.avg}ms | — |`);
  console.log(`| Proxy (no policy) | ${passthroughStats.p50}ms | ${passthroughStats.p95}ms | ${passthroughStats.p99}ms | ${passthroughStats.avg}ms | +${overheadNoPolicy}ms |`);
  console.log(`| Proxy (blocking policy) | ${blockingStats.p50}ms | ${blockingStats.p95}ms | ${blockingStats.p99}ms | ${blockingStats.avg}ms | +${overheadWithPolicy}ms |`);
  console.log(`\nProxy overhead (no policy): +${overheadNoPolicy}ms per call`);
  console.log(`Proxy overhead (with policy): +${overheadWithPolicy}ms per call`);
}

main().catch(console.error);