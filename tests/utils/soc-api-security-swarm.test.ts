import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { SocApiServerHandle } from '../../src/soc-api-server.js';

let handle: SocApiServerHandle | null = null;
let upstream: Server | null = null;

async function startUpstream(handler: Parameters<typeof createServer>[0]): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
  return { server, port };
}

async function startServerWithMocks(): Promise<SocApiServerHandle> {
  vi.resetModules();
  vi.doMock('../../src/container.js', () => ({
    createContainer: vi.fn(async () => ({
      db: {
        close: vi.fn(async () => undefined),
        getDistinctActiveServers: vi.fn(async () => []),
        getCallRecordsForServer: vi.fn(async () => []),
      },
    })),
  }));
  vi.doMock('../../src/ai/shadow-red-team.js', () => ({
    loadToolBaseline: vi.fn(() => [{
      serverName: 'filesystem',
      fingerprint: 'fp',
      toolNames: ['read_file'],
      tools: [{ name: 'read_file', descriptionHash: 'desc', schemaHash: 'schema' }],
      capturedAt: new Date('2026-07-03T00:00:00.000Z').toISOString(),
    }]),
  }));
  vi.doMock('../../src/ai/supply-chain-loader.js', () => ({
    loadToolCallCounts: vi.fn(async () => ({ 'filesystem:read_file': 3 })),
  }));
  vi.doMock('../../src/utils/security-swarm-runner.js', () => ({
    getSwarmJobStatus: vi.fn(() => ({
      jobId: 'job-1',
      tenantId: 'default',
      state: 'running',
      phase: 'preflight',
      phaseLabel: 'Preflight checks',
      progressPct: 10,
      startedAt: '2026-07-03T00:00:00.000Z',
      finishedAt: null,
      exitCode: null,
      error: null,
      analysisPath: '/tmp/analysis.txt',
      logTail: '',
      hasRun: true,
    })),
    startSwarmAnalysis: vi.fn(() => ({
      ok: true,
      jobId: 'job-1',
      startedAt: '2026-07-03T00:00:00.000Z',
      tenantId: 'default',
    })),
  }));
  const mod = await import('../../src/soc-api-server.js');
  return mod.startSocApiServer(0);
}

describe('soc-api security-swarm routes', () => {
  afterEach(async () => {
    await handle?.close();
    await new Promise<void>((resolve) => upstream?.close(() => resolve()) ?? resolve());
    handle = null;
    upstream = null;
    delete process.env.SOC_SECURITY_SWARM_UPSTREAM;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('serves supply-chain graph data from real graph builders', async () => {
    handle = await startServerWithMocks();
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/security-swarm/supply-chain?window=7`);
    const body = await res.json() as { graph?: { nodes?: unknown[]; edges?: unknown[] }; callCounts?: Record<string, number> };

    expect(res.status).toBe(200);
    expect(body.graph?.nodes?.length).toBeGreaterThan(0);
    expect(body.graph?.edges?.length).toBeGreaterThan(0);
    expect(body.callCounts?.['filesystem:read_file']).toBe(3);
  });

  it('starts swarm analysis with 202 instead of a fake HTTP 200 failure', async () => {
    handle = await startServerWithMocks();
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/security-swarm/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ full: false }),
    });
    const body = await res.json() as { jobId?: string; startedAt?: string; ok?: boolean };

    expect(res.status).toBe(202);
    expect(body).toEqual({ jobId: 'job-1', startedAt: '2026-07-03T00:00:00.000Z' });
    expect(body.ok).toBeUndefined();
  });

  it('forwards unimplemented security-swarm routes to dashboard upstream', async () => {
    const forwarded = await startUpstream((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        url: req.url,
        tenant: req.headers['x-mastyf-ai-tenant'],
        fromDashboard: true,
      }));
    });
    upstream = forwarded.server;
    process.env.SOC_SECURITY_SWARM_UPSTREAM = `http://127.0.0.1:${forwarded.port}`;

    handle = await startServerWithMocks();
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/security-swarm/report-json?window=7`, {
      headers: { 'x-mastyf-ai-tenant': 'acme' },
    });
    const body = await res.json() as { url?: string; tenant?: string; fromDashboard?: boolean };

    expect(res.status).toBe(200);
    expect(body).toEqual({
      url: '/api/security-swarm/report-json?window=7',
      tenant: 'acme',
      fromDashboard: true,
    });
  });
});
