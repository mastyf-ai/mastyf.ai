import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { McpProxyServer } from '../../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { PolicyConfig } from '../../src/policy/policy-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ECHO_SERVER = resolve(__dirname, '..', 'fixtures', 'echo-server.cjs');

export const PROXY_BENCH_POLICY: PolicyConfig = {
  version: '1.0',
  policy: {
    mode: 'block',
    rules: [{ name: 'deny-eval', action: 'block', tools: { deny: ['eval'] } }],
    default_action: 'pass',
  },
};

/** Tiered p95 SLO gates for realistic in-flight concurrency (deployment SLOs). */
export const PROXY_TIER_P95_SLO_MS: Record<number, number> = {
  1: 150,
  10: 500,
  25: 1500,
  50: 3000,
};

export type CallOutcome = {
  latencyMs: number;
  ok: boolean;
  blocked: boolean;
  error?: string;
  timeout?: boolean;
};

export type LatencyStats = { p50: number; p95: number; p99: number; max: number; avg: number };

type PendingEntry = {
  resolve: (msg: Record<string, unknown>) => void;
  reject: (err: Error) => void;
};

export function parseConcurrencyList(raw?: string): number[] {
  const env = raw ?? process.env.BENCH_PROXY_CONCURRENCY_TIERS ?? '1,10,25,50';
  return env
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function stats(latencies: number[]): LatencyStats {
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

export function expectedBlocked(i: number): boolean {
  return i % 10 === 0;
}

export function toolForIndex(i: number): string {
  return expectedBlocked(i) ? 'eval' : 'search';
}

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
      clientInfo: { name: 'proxy-bench', version: '1.0' },
    },
  });
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

export type ProxyBenchSessionOptions = {
  serverName?: string;
  responseTimeoutMs?: number;
  /** When false, proxy JSON-RPC is not written to process.stdout (avoids pipe deadlock in fork workers). */
  forwardStdout?: boolean;
};

/**
 * In-process McpProxyServer harness with stdout JSON-RPC correlation (one instance per process).
 */
export class ProxyBenchSession {
  private proxy!: McpProxyServer;
  private db!: HistoryDatabase;
  private pending = new Map<string, PendingEntry>();
  private origStdout!: typeof process.stdout.write;
  private readonly responseTimeoutMs: number;

  constructor(private readonly opts: ProxyBenchSessionOptions = {}) {
    this.responseTimeoutMs = opts.responseTimeoutMs ?? Number(process.env.CONCURRENT_PROXY_TIMEOUT_MS ?? 60000);
  }

  async start(): Promise<void> {
    this.db = new HistoryDatabase(':memory:');
    const policyEngine = new PolicyEngine(PROXY_BENCH_POLICY);
    this.proxy = new McpProxyServer(
      'node',
      [ECHO_SERVER],
      {},
      this.db,
      this.opts.serverName ?? 'proxy-bench',
      policyEngine,
    );

    this.origStdout = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
      try {
        const msg = JSON.parse(String(chunk)) as Record<string, unknown>;
        const id = msg.id != null ? String(msg.id) : null;
        if (id && this.pending.has(id)) {
          const entry = this.pending.get(id)!;
          this.pending.delete(id);
          entry.resolve(msg);
        }
      } catch {
        // non-JSON stdout
      }
      if (this.opts.forwardStdout !== false) {
        return this.origStdout(chunk as Buffer, ...(args as Parameters<typeof process.stdout.write>));
      }
      return true;
    }) as typeof process.stdout.write;

    await new Promise((r) => setTimeout(r, 300));

    const initId = '0';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('initialize timeout')), 10000);
      this.pending.set(initId, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      void this.proxy.handleClientInput(createInitialize(0));
    });
    this.pending.delete(initId);
    await new Promise((r) => setTimeout(r, 200));
  }

  async stop(): Promise<void> {
    process.stdout.write = this.origStdout;
    this.proxy.kill();
    this.db.close();
  }

  private async runOne(i: number): Promise<CallOutcome> {
    const id = String(i);
    const tool = toolForIndex(i);
    const raw = createCall(i, tool, { query: `bench-${i}`, path: `/tmp/f${i}.txt` });

    const responsePromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${this.responseTimeoutMs}ms`));
      }, this.responseTimeoutMs);
      this.pending.set(id, {
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
      await this.proxy.handleClientInput(raw);
      const msg = await responsePromise;
      const latencyMs = performance.now() - t0;
      const outcome = checkOutcome(i, msg);
      return { latencyMs, ok: outcome.ok, blocked: outcome.blocked, error: outcome.error };
    } catch (err) {
      this.pending.delete(id);
      return {
        latencyMs: performance.now() - t0,
        ok: false,
        blocked: false,
        error: err instanceof Error ? err.message : String(err),
        timeout: err instanceof Error && err.message.includes('timeout'),
      };
    }
  }

  async runConcurrent(count: number, idOffset = 0): Promise<{ outcomes: CallOutcome[]; wallMs: number }> {
    const wallStart = Date.now();
    const outcomes = await Promise.all(
      Array.from({ length: count }, (_, j) => this.runOne(idOffset + j)),
    );
    return { outcomes, wallMs: Date.now() - wallStart };
  }
}

export function summarizeOutcomes(
  outcomes: CallOutcome[],
  concurrency: number,
  p95SloMs: number,
): {
  correctness: Record<string, number>;
  latencyMs: LatencyStats;
  sloResults: Record<string, boolean | number>;
} {
  const latencies = outcomes.map((o) => o.latencyMs);
  const latencyMs = stats(latencies);
  const passed = outcomes.filter((o) => o.ok).length;
  const failed = concurrency - passed;
  const timeouts = outcomes.filter((o) => o.timeout).length;

  let expectedBlockedCount = 0;
  let blocked = 0;
  let allowed = 0;
  const expectedAllowed = concurrency - Math.floor(concurrency / 10);
  for (let i = 0; i < concurrency; i++) {
    if (expectedBlocked(i)) expectedBlockedCount++;
    if (outcomes[i].blocked) blocked++;
    if (outcomes[i].ok && !outcomes[i].blocked) allowed++;
  }

  const correctnessPct = concurrency > 0 ? Math.round((passed / concurrency) * 10000) / 100 : 0;
  const sloResults = {
    p95Ms: p95SloMs,
    p95Pass: latencyMs.p95 <= p95SloMs,
    correctnessPass: failed === 0 && timeouts === 0,
    overallPass: false as boolean,
  };
  sloResults.overallPass = sloResults.correctnessPass && sloResults.p95Pass;

  return {
    correctness: {
      total: concurrency,
      passed,
      failed,
      correctnessPct,
      expectedBlocked: expectedBlockedCount,
      blocked,
      expectedAllowed,
      allowed,
      timeouts,
    },
    latencyMs,
    sloResults,
  };
}
