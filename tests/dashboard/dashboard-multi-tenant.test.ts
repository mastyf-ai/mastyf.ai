import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { HistoryDatabase } from '../../src/database/history-db.js';
import {
  startDashboardServer,
  closeDashboardServer,
  setDashboardDataSource,
} from '../../src/utils/dashboard-server.js';
import { WsBroadcaster } from '../../src/dashboard/ws-broadcaster.js';
import { createServer } from 'node:http';

const PORT = 41399;
const WS_PORT = 41400;

function baseRecord(tenantId: string, toolName: string) {
  return {
    serverName: 'echo-test',
    toolName,
    requestTokens: 10,
    responseTokens: 20,
    totalTokens: 30,
    durationMs: 5,
    timestamp: new Date().toISOString(),
    blocked: false,
    tenantId,
  };
}

describe('dashboard multi-tenant isolation', () => {
  let tmpDir: string;
  let db: HistoryDatabase;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dash-mt-'));
    db = new HistoryDatabase(join(tmpDir, 'history.db'));
    await db.initialize();
    await db.addCallRecord(baseRecord('tenant-a', 'only-a'));
    await db.addCallRecord(baseRecord('tenant-b', 'only-b'));

    process.env.DASHBOARD_ENABLED = 'true';
    process.env.DASHBOARD_AUTH_DISABLED = 'true';
    process.env.GUARDIAN_WS_ENABLED = 'true';
    process.env.GUARDIAN_MULTI_TENANT_ENABLED = 'true';

    setDashboardDataSource(db);
    await startDashboardServer(PORT);
  });

  afterAll(async () => {
    await closeDashboardServer();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.DASHBOARD_ENABLED;
    delete process.env.DASHBOARD_AUTH_DISABLED;
    delete process.env.GUARDIAN_WS_ENABLED;
    delete process.env.GUARDIAN_MULTI_TENANT_ENABLED;
  });

  it('serves /api/audit/heatmap as chart data (not shadowed by /api/audit)', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/audit/heatmap?window=7d`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      available?: boolean;
      cells?: unknown[];
      activity?: { days?: string[] };
      kind?: string;
    };
    expect(body.available).toBe(true);
    expect(Array.isArray(body.cells)).toBe(true);
    expect(body.activity?.days).toBeDefined();
    expect(body.kind).toBeUndefined();
  });

  it('scopes /api/aggregate/audit by X-Guardian-Tenant', async () => {
    const resA = await fetch(`http://127.0.0.1:${PORT}/api/aggregate/audit`, {
      headers: { 'X-Guardian-Tenant': 'tenant-a' },
    });
    expect(resA.ok).toBe(true);
    const bodyA = (await resA.json()) as { events: Array<{ tool_name: string }> };
    expect(bodyA.events.some((e) => e.tool_name === 'only-a')).toBe(true);
    expect(bodyA.events.some((e) => e.tool_name === 'only-b')).toBe(false);

    const resB = await fetch(`http://127.0.0.1:${PORT}/api/aggregate/audit`, {
      headers: { 'X-Guardian-Tenant': 'tenant-b' },
    });
    const bodyB = (await resB.json()) as { events: Array<{ tool_name: string }> };
    expect(bodyB.events.some((e) => e.tool_name === 'only-b')).toBe(true);
    expect(bodyB.events.some((e) => e.tool_name === 'only-a')).toBe(false);
  });

  it('scopes semantic outcomes by tenant', async () => {
    const prevHome = process.env.HOME;
    process.env.HOME = tmpDir;
    const semLine = (tenantId: string, toolName: string) => {
      const dir = join(tmpDir, '.mcp-guardian', 'tenants', tenantId);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'semantic-audit-outcomes.jsonl');
      const row = {
        id: `${tenantId}-1`,
        tenantId,
        requestId: 1,
        serverName: 's',
        toolName,
        syncDecision: { action: 'pass' },
        semanticAudit: { suspicious: true, confidence: 0.9, reason: 'test' },
        timestamp: new Date().toISOString(),
      };
      writeFileSync(path, `${JSON.stringify(row)}\n`, 'utf-8');
    };
    semLine('tenant-a', 'sem-a');
    semLine('tenant-b', 'sem-b');

    const resA = await fetch(`http://127.0.0.1:${PORT}/api/learning/semantic/outcomes`, {
      headers: { 'X-Guardian-Tenant': 'tenant-a' },
    });
    const dataA = (await resA.json()) as { records: Array<{ toolName?: string }> };
    expect(dataA.records.some((r) => r.toolName === 'sem-a')).toBe(true);
    expect(dataA.records.some((r) => r.toolName === 'sem-b')).toBe(false);

    if (prevHome) process.env.HOME = prevHome;
    else delete process.env.HOME;
  });
});

describe('WsBroadcaster tenant channels', () => {
  it('delivers metrics only to matching tenant subscription', async () => {
    const httpServer = createServer();
    await new Promise<void>((r) => httpServer.listen(WS_PORT, '127.0.0.1', () => r()));
    const broadcaster = new WsBroadcaster(httpServer);
    broadcaster.setDataProviders({
      metrics: (tenantId: string) => ({
        totalRequests: tenantId === 'tenant-a' ? 1 : 99,
        tenantId,
      }),
    });

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      const wsA = new WebSocket(`ws://127.0.0.1:${WS_PORT}/ws`);
      const wsB = new WebSocket(`ws://127.0.0.1:${WS_PORT}/ws`);
      let open = 0;
      const onOpen = () => {
        open += 1;
        if (open === 2) {
          wsA.send(JSON.stringify({
            type: 'subscribe',
            channels: ['metrics'],
            tenantId: 'tenant-a',
          }));
          wsB.send(JSON.stringify({
            type: 'subscribe',
            channels: ['metrics'],
            tenantId: 'tenant-b',
          }));
          setTimeout(() => {
            broadcaster.broadcast({
              type: 'metrics:live',
              tenantId: 'tenant-a',
              payload: { metrics: { totalRequests: 1, tenantId: 'tenant-a' } },
              timestamp: Date.now(),
            });
            setTimeout(() => {
              wsA.close();
              wsB.close();
              resolve();
            }, 150);
          }, 80);
        }
      };
      wsA.on('open', onOpen);
      wsB.on('open', onOpen);
      wsA.on('message', (d) => receivedA.push(JSON.parse(d.toString())));
      wsB.on('message', (d) => receivedB.push(JSON.parse(d.toString())));
      wsA.on('error', reject);
      wsB.on('error', reject);
    });

    const tenantAMetrics = (list: unknown[]) =>
      list.filter((m) => {
        const msg = m as { type?: string; payload?: { metrics?: { totalRequests?: number } } };
        return msg.type === 'metrics:live' && msg.payload?.metrics?.totalRequests === 1;
      });
    expect(tenantAMetrics(receivedA).length).toBeGreaterThan(0);
    expect(tenantAMetrics(receivedB).length).toBe(0);

    await new Promise<void>((r) => httpServer.close(() => r()));
  });
});
