import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startDashboardServer,
  closeDashboardServer,
} from '../../src/utils/dashboard-server.js';

const PORT = 41402;

describe('dashboard threat intel actions', () => {
  let tmpDir: string;
  let threatStatePath: string;
  let policyPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dash-threat-intel-'));
    threatStatePath = join(tmpDir, '.threat-state.json');
    policyPath = join(tmpDir, 'policy.yaml');
    writeFileSync(policyPath, 'version: "1.0"\npolicy:\n  mode: block\n  rules: []\n');
    writeFileSync(threatStatePath, JSON.stringify({
      ids: ['osv-GHSA-test-threat'],
      entries: [{
        id: 'osv-GHSA-test-threat',
        source: 'OSV',
        severity: 'CRITICAL',
        description: 'Test threat',
        remediation: 'Patch',
        publishedAt: new Date().toISOString(),
        affectedPackage: '@modelcontextprotocol/sdk',
        affectedPattern: '@modelcontextprotocol/sdk',
        firstSeenAt: new Date().toISOString(),
      }],
      suppressed: {},
      quarantineArchive: [],
    }));
    process.env.DASHBOARD_ENABLED = 'true';
    process.env.DASHBOARD_AUTH_DISABLED = 'true';
    process.env.GUARDIAN_CI_BYPASS_LICENSE = 'true';
    process.env.GUARDIAN_AI_DISABLE_THREAT_POLL = 'true';
    process.env.GUARDIAN_THREAT_STATE_PATH = threatStatePath;
    process.env.GUARDIAN_POLICY_PATH = policyPath;
    await startDashboardServer(PORT);
  });

  afterAll(async () => {
    await closeDashboardServer();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.DASHBOARD_ENABLED;
    delete process.env.DASHBOARD_AUTH_DISABLED;
    delete process.env.GUARDIAN_CI_BYPASS_LICENSE;
    delete process.env.GUARDIAN_AI_DISABLE_THREAT_POLL;
    delete process.env.GUARDIAN_THREAT_STATE_PATH;
    delete process.env.GUARDIAN_POLICY_PATH;
  });

  it('dismisses and restores threat-intel rows', async () => {
    const dismiss = await fetch(`http://127.0.0.1:${PORT}/api/ai/threats/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'osv-GHSA-test-threat' }),
    });
    expect(dismiss.ok).toBe(true);
    const listAfterDismiss = await fetch(`http://127.0.0.1:${PORT}/api/ai/threats`);
    const statusAfterDismiss = (await listAfterDismiss.json()) as { entries: Array<{ id: string }> };
    expect(statusAfterDismiss.entries.some((e) => e.id === 'osv-GHSA-test-threat')).toBe(false);

    const restore = await fetch(`http://127.0.0.1:${PORT}/api/ai/threats/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'osv-GHSA-test-threat' }),
    });
    expect(restore.ok).toBe(true);
    const listAfterRestore = await fetch(`http://127.0.0.1:${PORT}/api/ai/threats`);
    const statusAfterRestore = (await listAfterRestore.json()) as { entries: Array<{ id: string }> };
    expect(statusAfterRestore.entries.some((e) => e.id === 'osv-GHSA-test-threat')).toBe(true);
  });

  it('quarantines and records archive rows', async () => {
    const quarantine = await fetch(`http://127.0.0.1:${PORT}/api/ai/threats/quarantine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'osv-GHSA-test-threat', note: 'test quarantine' }),
    });
    expect(quarantine.ok).toBe(true);
    const body = (await quarantine.json()) as { appliedRuleName?: string };
    expect(body.appliedRuleName).toBeTruthy();

    const list = await fetch(`http://127.0.0.1:${PORT}/api/ai/threats/quarantined?days=30`);
    expect(list.ok).toBe(true);
    const quarantined = (await list.json()) as { entries: Array<{ id: string; appliedRuleName?: string }> };
    expect(quarantined.entries.some((e) => e.id === 'osv-GHSA-test-threat')).toBe(true);
  });
});
