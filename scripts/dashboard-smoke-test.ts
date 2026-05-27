#!/usr/bin/env npx tsx
/**
 * Live dashboard smoke test — starts dashboard-server locally and probes Tier 1/2 APIs + static shell.
 */
import { appendSemanticAuditRecord } from '../src/ai/semantic-audit-store.js';
import { startDashboardServer, closeDashboardServer } from '../src/utils/dashboard-server.js';

const PORT = parseInt(process.env.SMOKE_PORT || '41777', 10);
const BASE = `http://127.0.0.1:${PORT}`;

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name} — ${detail}`);
}

async function getJson(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, init);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  process.env.DASHBOARD_ENABLED = 'true';
  process.env.DASHBOARD_AUTH_DISABLED = 'true';
  process.env.GUARDIAN_WS_ENABLED = 'false';
  process.env.GUARDIAN_CI_BYPASS_LICENSE = 'true';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';

  const seed = appendSemanticAuditRecord({
    requestId: 'smoke-inv-1',
    serverName: 'filesystem',
    toolName: 'read_file',
    syncDecision: { action: 'block', rule: 'path-guard', reason: 'smoke test seed' },
    semanticAudit: {
      suspicious: true,
      confidence: 0.88,
      categories: ['path-traversal'],
      reasoning: 'Smoke test semantic flag',
    },
    timestamp: new Date().toISOString(),
    argumentsSnapshot: { path: '/etc/passwd' },
  });

  await startDashboardServer(PORT);
  console.log(`[smoke] Dashboard listening on ${BASE}`);

  try {
    const index = await fetch(`${BASE}/`);
    const indexHtml = index.ok ? await index.text() : '';
    const isReactShell = indexHtml.includes('/_next/') && !indexHtml.includes('/dashboard-spa/app.js');
    record('GET / (React SPA)', index.ok && isReactShell, `status=${index.status} react=${isReactShell}`);

    const auth = await getJson('/api/auth/status');
    record('GET /api/auth/status', auth.status === 200, `status=${auth.status}`);

    const supply = await getJson('/api/security-swarm/supply-chain?window=7');
    const supplyBody = supply.body as Record<string, unknown> | null;
    record(
      'GET /api/security-swarm/supply-chain',
      supply.status === 200 && supplyBody?.graph != null,
      `status=${supply.status} hasGraph=${!!supplyBody?.graph}`,
    );

    const hints = await getJson('/api/fleet/signature-hints');
    record('GET /api/fleet/signature-hints', hints.status === 200, `status=${hints.status}`);

    const compliance = await getJson('/api/ai/compliance/report?window=7&useLlm=false');
    const compBody = compliance.body as Record<string, unknown> | null;
    record(
      'GET /api/ai/compliance/report',
      compliance.status === 200 && typeof compBody?.markdown === 'string',
      `status=${compliance.status} markdown=${typeof compBody?.markdown}`,
    );

    const tribunal = await getJson('/api/learning/semantic/tribunal?limit=10&useLlm=false');
    record('GET /api/learning/semantic/tribunal', tribunal.status === 200, `status=${tribunal.status}`);

    const readiness = await getJson('/api/ai/tenant-model/readiness');
    record('GET /api/ai/tenant-model/readiness', readiness.status === 200, `status=${readiness.status}`);

    const exportTrain = await getJson('/api/ai/tenant-model/train', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'export' }),
    });
    const exportBody = exportTrain.body as Record<string, unknown> | null;
    record(
      'POST /api/ai/tenant-model/train (export)',
      exportTrain.status === 200 && exportBody?.action === 'export',
      `status=${exportTrain.status} rows=${String(exportBody?.rowsExported ?? '—')}`,
    );

    const trainStatus = await getJson('/api/ai/tenant-model/train/status');
    record('GET /api/ai/tenant-model/train/status', trainStatus.status === 200, `status=${trainStatus.status}`);

    const counter = await getJson('/api/policy/copilot/counterfactual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowDays: 7 }),
    });
    const counterBody = counter.body as Record<string, unknown> | null;
    record(
      'POST /api/policy/copilot/counterfactual',
      counter.status === 200 && typeof counterBody?.summary === 'string',
      `status=${counter.status} summary=${typeof counterBody?.summary}`,
    );

    const investigate = await getJson('/api/incidents/investigate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerId: seed.id, useLlm: false }),
    });
    const invBody = investigate.body as Record<string, unknown> | null;
    record(
      'POST /api/incidents/investigate',
      investigate.status === 200 && invBody?.incidentId != null,
      `status=${investigate.status} incidentId=${String(invBody?.incidentId ?? 'missing')}`,
    );

    const activeLearning = await getJson('/api/learning/semantic/active-learning');
    record(
      'GET /api/learning/semantic/active-learning',
      activeLearning.status === 200,
      `status=${activeLearning.status}`,
    );

    const analytics = await getJson('/api/analytics/summary?window=7d');
    const analyticsBody = analytics.body as Record<string, unknown> | null;
    record(
      'GET /api/analytics/summary',
      analytics.status === 200 && analyticsBody != null,
      `status=${analytics.status} available=${String(analyticsBody?.available)}`,
    );

    const secDash = await getJson('/api/security/dashboard?window=24h');
    const secBody = secDash.body as Record<string, unknown> | null;
    record(
      'GET /api/security/dashboard',
      secDash.status === 200 && Array.isArray(secBody?.threats),
      `status=${secDash.status} threats=${Array.isArray(secBody?.threats) ? (secBody!.threats as unknown[]).length : '—'}`,
    );

    const setupStatus = await getJson('/api/setup/status');
    record('GET /api/setup/status', setupStatus.status === 200, `status=${setupStatus.status}`);

    const setupDb = await getJson('/api/setup/db-health');
    record('GET /api/setup/db-health', setupDb.status === 200, `status=${setupDb.status}`);

    const setupCloud = await getJson('/api/setup/cloud-status');
    record('GET /api/setup/cloud-status', setupCloud.status === 200, `status=${setupCloud.status}`);
  } finally {
    await closeDashboardServer();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log('');
  console.log(`[smoke] ${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.error('[smoke] Failed:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
  console.log('[smoke] All dashboard smoke checks passed');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] Fatal:', err);
  process.exit(1);
});
