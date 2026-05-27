import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SecurityThreatQuarantine,
  resetSecurityThreatQuarantineForTests,
} from '../../src/utils/security-threat-quarantine.js';

describe('SecurityThreatQuarantine', () => {
  let home: string;
  const prevHome = process.env.MCP_GUARDIAN_HOME;

  beforeEach(() => {
    resetSecurityThreatQuarantineForTests();
    home = mkdtempSync(join(tmpdir(), 'guardian-q-'));
    process.env.MCP_GUARDIAN_HOME = home;
  });

  afterEach(() => {
    resetSecurityThreatQuarantineForTests();
    if (prevHome === undefined) delete process.env.MCP_GUARDIAN_HOME;
    else process.env.MCP_GUARDIAN_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('quarantines and restores a monitor threat', () => {
    const q = new SecurityThreatQuarantine('default');
    const row = {
      id: 'THR-S2840',
      threatKey: 'semantic:abc-1',
      type: 'Semantic Prompt Injection',
      source: '10.2.7.32',
      severity: 'high' as const,
      status: 'blocked' as const,
    };
    expect(q.quarantine(row).ok).toBe(true);
    expect(q.isQuarantined('semantic:abc-1')).toBe(true);
    expect(q.list(30)).toHaveLength(1);
    expect(q.list(30)[0]?.enforcementStatus).toBe('skipped');
    expect(q.list(30)[0]?.sourceKind).toBe('unknown');
    const restored = q.restore('semantic:abc-1');
    expect(restored.ok).toBe(true);
    expect(restored.record?.threatKey).toBe('semantic:abc-1');
    expect(q.isQuarantined('semantic:abc-1')).toBe(false);
  });

  it('quarantineMany skips already quarantined keys', () => {
    const q = new SecurityThreatQuarantine('default');
    const row = {
      id: 'THR-1',
      threatKey: 'block:a:b:1',
      type: 'Test',
      source: '10.0.0.1',
      severity: 'critical' as const,
      status: 'blocked' as const,
    };
    q.quarantine(row);
    const res = q.quarantineMany([row, row]);
    expect(res.quarantined).toBe(0);
  });

  it('findEntry matches threatKey with spaces and colons', () => {
    const q = new SecurityThreatQuarantine('default');
    const threatKey = 'block:official-filesystem:read_text_file:2026-05-27 19:05:06';
    q.quarantine({
      id: 'THR-3450',
      threatKey,
      type: 'Semantic Prompt Injection',
      source: '10.13.195.218',
      severity: 'critical',
      status: 'blocked',
    });
    expect(q.findEntry(30, { threatKey })?.id).toBe('THR-3450');
    expect(q.findEntry(30, { id: 'THR-3450' })?.threatKey).toBe(threatKey);
  });

  it('stores enforcement metadata', () => {
    const q = new SecurityThreatQuarantine('default');
    const row = {
      id: 'THR-M1',
      threatKey: 'semantic:meta-1',
      type: 'Semantic Prompt Injection',
      source: '10.9.1.2',
      severity: 'critical' as const,
      status: 'monitored' as const,
    };
    const result = q.quarantine(row, 'operator@test', 'manual', {
      sourceKind: 'semantic',
      enforcementStatus: 'applied',
      appliedRuleName: 'quarantine-semantic-meta-1',
      policyPath: '/tmp/policy.yaml',
      enforcementDetail: 'Applied semantic hardening rule',
    });
    expect(result.ok).toBe(true);
    expect(result.record?.sourceKind).toBe('semantic');
    expect(result.record?.enforcementStatus).toBe('applied');
    expect(result.record?.appliedRuleName).toContain('quarantine-semantic');
  });
});
