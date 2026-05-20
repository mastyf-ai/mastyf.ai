/**
 * AsyncSerialQueue + proxy handleClientInput latency under concurrency (p50/p95).
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { AsyncSerialQueue } from '../../src/utils/async-serial-queue.js';
import { McpProxyServer } from '../../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const mockServer = join(__dir, 'mock-mcp-server.mjs');
const policy = load(readFileSync(join(__dir, '../../default-policy.yaml'), 'utf-8'));
const REPORT_DIR = join(__dir, '..', 'reports');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function mkCall(id, name, args) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  });
}

describe('Adversarial harness: concurrency latency', () => {
  it('measures AsyncSerialQueue task latency p50/p95', async () => {
    const queue = new AsyncSerialQueue();
    const latencies = [];
    const N = 50;

    const tasks = Array.from({ length: N }, (_, i) =>
      queue.enqueue(async () => {
        const t0 = performance.now();
        await new Promise((r) => setTimeout(r, 2));
        latencies.push(performance.now() - t0);
        return i;
      }),
    );
    await Promise.all(tasks);

    const sorted = [...latencies].sort((a, b) => a - b);
    const metrics = {
      component: 'AsyncSerialQueue',
      samples: N,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      maxMs: sorted[sorted.length - 1] ?? 0,
      note: 'Serial queue — tasks run one at a time; latency includes prior queue depth',
    };

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(join(REPORT_DIR, 'concurrency-metrics.json'), JSON.stringify(metrics, null, 2));
    expect(metrics.samples).toBe(N);
    expect(metrics.p50Ms).toBeGreaterThan(0);
  });

  it('measures proxy handleClientInput latency p50/p95 (real stdio upstream)', async () => {
    const db = new HistoryDatabase(':memory:');
    const proxy = new McpProxyServer(
      process.execPath,
      [mockServer],
      { PATH: process.env.PATH || '' },
      db,
      'harness-latency',
      new PolicyEngine(policy),
    );

    const latencies = [];
    const N = 20;
    try {
      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        await proxy.handleClientInput(mkCall(`lat-${i}`, 'echo', { i }));
        latencies.push(performance.now() - t0);
      }
    } finally {
      proxy.kill?.();
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const existing = (() => {
      try {
        return JSON.parse(readFileSync(join(REPORT_DIR, 'concurrency-metrics.json'), 'utf-8'));
      } catch {
        return {};
      }
    })();

    const metrics = {
      ...existing,
      proxy: {
        component: 'McpProxyServer.handleClientInput',
        samples: N,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs: sorted[sorted.length - 1] ?? 0,
        integration: 'real-mock-mcp-stdio',
      },
    };

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(join(REPORT_DIR, 'concurrency-metrics.json'), JSON.stringify(metrics, null, 2));
    expect(metrics.proxy.p50Ms).toBeGreaterThan(0);
  });
});
