import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startDashboardServer,
  closeDashboardServer,
} from '../../src/utils/dashboard-server.js';

const PORT = 41403;

describe('dashboard security threat quarantine actions', () => {
  let tmpDir: string;
  let policyPath: string;
  let quarantinePath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dash-sec-quarantine-'));
    policyPath = join(tmpDir, 'policy.yaml');
    quarantinePath = join(tmpDir, 'security-threat-quarantine.json');
    writeFileSync(policyPath, [
      'version: "1.0"',
      'policy:',
      '  mode: block',
      '  rules:',
      '    - name: quarantine-semantic-restore-1',
      '      action: block',
      '      patterns: ["prompt"]',
      '',
    ].join('\n'));
    writeFileSync(quarantinePath, JSON.stringify({
      entries: [
        {
          id: 'THR-S1',
          threatKey: 'semantic:restore-1',
          type: 'Semantic Prompt Injection',
          source: '10.1.1.1',
          severity: 'critical',
          status: 'resolved',
          quarantinedAt: new Date().toISOString(),
          enforcementStatus: 'applied',
          sourceKind: 'semantic',
          appliedRuleName: 'quarantine-semantic-restore-1',
          policyPath,
        },
      ],
    }, null, 2));

    process.env.DASHBOARD_ENABLED = 'true';
    process.env.DASHBOARD_AUTH_DISABLED = 'true';
    process.env.MASTYF_AI_CI_BYPASS_LICENSE = 'true';
    process.env.MASTYF_AI_HOME = tmpDir;
    process.env.MASTYF_AI_POLICY_PATH = policyPath;
    await startDashboardServer(PORT);
  });

  afterAll(async () => {
    await closeDashboardServer();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.DASHBOARD_ENABLED;
    delete process.env.DASHBOARD_AUTH_DISABLED;
    delete process.env.MASTYF_AI_CI_BYPASS_LICENSE;
    delete process.env.MASTYF_AI_HOME;
    delete process.env.MASTYF_AI_POLICY_PATH;
  });

  it('returns enforcement metadata for monitor quarantine', async () => {
    const quarantine = await fetch(`http://127.0.0.1:${PORT}/api/security/threats/quarantine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'THR-S2',
        threatKey: 'semantic:missing-context',
        type: 'Semantic Prompt Injection',
        source: '10.2.2.2',
        severity: 'high',
        status: 'monitored',
      }),
    });
    expect(quarantine.ok).toBe(true);
    const body = (await quarantine.json()) as { enforcementStatus?: string; record?: { enforcementStatus?: string } };
    expect(body.enforcementStatus).toBeTruthy();
    expect(body.record?.enforcementStatus).toBeTruthy();
  });

  it('returns policy detail for quarantined monitor entry', async () => {
    const res = await fetch(
      `http://127.0.0.1:${PORT}/api/security/threats/quarantine/policy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threatKey: 'semantic:restore-1',
          id: 'THR-S1',
          record: {
            id: 'THR-S1',
            threatKey: 'semantic:restore-1',
            type: 'Semantic Prompt Injection',
            source: '10.1.1.1',
            severity: 'critical',
            status: 'resolved',
            quarantinedAt: new Date().toISOString(),
            appliedRuleName: 'quarantine-semantic-restore-1',
            policyPath,
            enforcementStatus: 'applied',
            sourceKind: 'semantic',
          },
        }),
      },
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      source?: string;
      quarantine?: { appliedRuleName?: string };
      appliedRule?: { name?: string };
    };
    expect(body.source).toBe('monitor');
    expect(body.quarantine?.appliedRuleName).toBe('quarantine-semantic-restore-1');
    expect(body.appliedRule?.name).toBe('quarantine-semantic-restore-1');
  });

  it('restores monitor entry and optionally removes applied rule', async () => {
    const restore = await fetch(`http://127.0.0.1:${PORT}/api/security/threats/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threatKey: 'semantic:restore-1', removeRule: true }),
    });
    expect(restore.ok).toBe(true);
    const body = (await restore.json()) as { removedRule?: boolean };
    expect(body.removedRule).toBe(true);

    const policy = readFileSync(policyPath, 'utf-8');
    expect(policy.includes('quarantine-semantic-restore-1')).toBe(false);
  });

  it('restores monitor group and removes all distinct applied rules', async () => {
    writeFileSync(policyPath, [
      'version: "1.0"',
      'policy:',
      '  mode: block',
      '  rules:',
      '    - name: quarantine-semantic-rule-a',
      '      action: block',
      '      patterns: ["prompt-a"]',
      '    - name: quarantine-semantic-rule-b',
      '      action: block',
      '      patterns: ["prompt-b"]',
      '',
    ].join('\n'));
    writeFileSync(quarantinePath, JSON.stringify({
      entries: [
        {
          id: 'THR-G1',
          threatKey: 'semantic:group-restore-a',
          type: 'Semantic Prompt Injection',
          source: '10.1.1.1',
          severity: 'critical',
          status: 'resolved',
          quarantinedAt: new Date().toISOString(),
          enforcementStatus: 'applied',
          sourceKind: 'semantic',
          appliedRuleName: 'quarantine-semantic-rule-a',
          policyPath,
        },
        {
          id: 'THR-G2',
          threatKey: 'semantic:group-restore-b',
          type: 'Semantic Prompt Injection',
          source: '10.1.1.1',
          severity: 'critical',
          status: 'resolved',
          quarantinedAt: new Date().toISOString(),
          enforcementStatus: 'applied',
          sourceKind: 'semantic',
          appliedRuleName: 'quarantine-semantic-rule-b',
          policyPath,
        },
      ],
    }, null, 2));

    const restore = await fetch(`http://127.0.0.1:${PORT}/api/security/threats/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threatKey: 'semantic:group-restore-a', removeRule: true }),
    });
    expect(restore.ok).toBe(true);
    const body = (await restore.json()) as { removedRule?: boolean; restored?: number };
    expect(body.removedRule).toBe(true);
    expect(body.restored).toBe(2);

    const policy = readFileSync(policyPath, 'utf-8');
    expect(policy.includes('quarantine-semantic-rule-a')).toBe(false);
    expect(policy.includes('quarantine-semantic-rule-b')).toBe(false);
  });
});
