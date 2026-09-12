/**
 * Golden-path / honesty gates for the MCP firewall console.
 * Canonical stack: pnpm dashboard:proxy (gateway-routes on :4000).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SocApiServerHandle } from '../../src/soc-api-server.js';
import {
  blockedKpiSecondary,
  isContradictingEmptyAggregate,
  isHarnessReceiptId,
} from '../../src/dashboard/perimeter-honesty.js';

describe('perimeter honesty helpers', () => {
  it('flags contradicting empty aggregate when ledger has blocks', () => {
    expect(
      isContradictingEmptyAggregate({ ledgerBlocked: 290, historyTotalRequests: 0 }),
    ).toBe(true);
    expect(
      isContradictingEmptyAggregate({ ledgerBlocked: 0, historyTotalRequests: 0 }),
    ).toBe(false);
  });

  it('never returns bare “No blocks” when ledger blocked > 0 and history empty', () => {
    const secondary = blockedKpiSecondary({
      historyBlocked: 0,
      ledgerBlocked: 290,
      historyTotalRequests: 0,
    });
    expect(secondary.toLowerCase()).not.toBe('no blocks');
    expect(secondary).toBe('');
  });
});

describe('soc-api gateway golden path BFF', () => {
  let handle: SocApiServerHandle | null = null;

  afterEach(async () => {
    await handle?.close();
    handle = null;
    delete process.env.MASTYF_AI_AUTH_DISABLED;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function startServer(): Promise<SocApiServerHandle> {
    vi.resetModules();
    process.env.MASTYF_AI_AUTH_DISABLED = 'true';
    vi.doMock('../../src/container.js', () => ({
      createContainer: vi.fn(async () => ({
        db: {
          close: vi.fn(async () => undefined),
          getDistinctActiveServers: vi.fn(async () => []),
          getCallRecordsForServer: vi.fn(async () => []),
        },
      })),
    }));
    const mod = await import('../../src/soc-api-server.js');
    return mod.startSocApiServer(0);
  }

  it('GET /api/gateway/status is not route-not-found', async () => {
    handle = await startServer();
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/gateway/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available?: boolean; error?: string };
    expect(String(body.error || '')).not.toMatch(/route not found/i);
    expect(body).toHaveProperty('available');
  });

  it('GET /api/gateway/bff-info reports gateway-routes + history db fingerprint', async () => {
    handle = await startServer();
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/gateway/bff-info`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bff?: string;
      canonical_command?: string;
      history_db?: { basename?: string; exists?: boolean };
    };
    expect(body.bff).toBe('gateway-routes');
    expect(body.canonical_command).toBe('pnpm dashboard:proxy');
    expect(body.history_db?.basename).toBeTruthy();
  });

  it('POST /api/gateway/decide is not 404', async () => {
    handle = await startServer();
    const { setGatewayClient } = await import('../../src/dashboard/gateway-routes.js');
    setGatewayClient({
      decide: async () => ({ decision: 'ALLOW', reason_code: 'TEST_DECIDE', source: 'harness' }),
    } as any);

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/gateway/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_name: 'read_file', tool_args: {} }),
    });
    expect(res.status).not.toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(String(body.error || '')).not.toMatch(/route not found/i);
    expect(body.decision).toBe('ALLOW');
  });

  it('POST /api/gateway/escalation/allow accepts confirmation-shaped body without 404', async () => {
    handle = await startServer();
    const { setGatewayClient } = await import('../../src/dashboard/gateway-routes.js');
    setGatewayClient({
      resolveEscalation: async () => ({
        ok: true,
        control_receipt: { receipt_id: 'cr-test-1' },
      }),
      allowEscalation: async () => ({
        ok: true,
        control_receipt: { receipt_id: 'cr-test-1' },
      }),
    } as any);

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/gateway/escalation/allow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipt_id: 'rcpt-1', confirmation: true }),
    });
    expect(res.status).not.toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(String(body.error || '')).not.toMatch(/route not found/i);
  });

  it('GET /api/gateway/evidence-pack assembles live-ledger pack without self-test by default', async () => {
    handle = await startServer();
    const { setGatewayClient } = await import('../../src/dashboard/gateway-routes.js');
    setGatewayClient({
      status: async () => ({ available: true, ledger: { chain_integrity: true, total_receipts: 1 } }),
      protection: async () => ({ total_servers: 0 }),
      policy: async () => ({ id: 'p1', hash: 'abc' }),
      receipts: async () => ({
        receipts: [
          {
            receipt_id: 'r1',
            decision: 'BLOCK',
            tool_name: 'x',
            backend_execution_count: 0,
          },
        ],
      }),
      controlReceipts: async () => ({ receipts: [{ receipt_id: 'cr1' }] }),
      serverStats: async () => ({ servers: [] }),
      deploymentManifest: async () => ({ version: 'test' }),
      selfTest: async () => {
        throw new Error('self-test should not run by default');
      },
    } as any);

    const res = await fetch(`http://127.0.0.1:${handle.port}/api/gateway/evidence-pack`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.assembled_by).toBe('bff-evidence-pack');
    expect(body.source).toBe('live-gateway');
    expect(body.self_test?.skipped).toBe(true);
    expect(body.incident_narratives?.length).toBe(1);
  });

  it('POST threat-lab from-receipt/review requires human_accept + replay for accept', async () => {
    handle = await startServer();
    const res = await fetch(
      `http://127.0.0.1:${handle.port}/api/gateway/threat-lab/from-receipt/review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'tl-x', action: 'accept' }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('HUMAN_ACCEPT_REQUIRED');
  });
});

describe('harness receipt labels', () => {
  it('marks probe ids and leaves customer ids alone', () => {
    expect(isHarnessReceiptId('slo-e2e-prom')).toBe(true);
    expect(isHarnessReceiptId('node-e2e-lat-2')).toBe(true);
    expect(isHarnessReceiptId('obs-prom-1')).toBe(true);
    expect(isHarnessReceiptId('allow_once_next_1710000000')).toBe(true);
    expect(isHarnessReceiptId('smoke-p7-block-99d2522ad16b')).toBe(false);
    expect(isHarnessReceiptId('shield-c61215ec-aa')).toBe(false);
  });
});
