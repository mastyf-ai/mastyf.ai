import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildSecurityDashboard,
  filterVisibleMonitorThreats,
  threatDisplayFingerprint,
  type SecurityThreatRow,
} from '../../src/utils/security-dashboard.js';
import {
  getSecurityThreatQuarantine,
  resetSecurityThreatQuarantineForTests,
} from '../../src/utils/security-threat-quarantine.js';

describe('buildSecurityDashboard', () => {
  it('returns empty-state payload without database', async () => {
    const payload = await buildSecurityDashboard(null, 'default', 1);
    expect(payload.available).toBe(false);
    expect(payload.threats).toEqual([]);
    expect(payload.layers).toHaveLength(4);
  });
});

describe('filterVisibleMonitorThreats', () => {
  let home: string;
  const prevHome = process.env.MASTYF_AI_HOME;

  beforeEach(() => {
    resetSecurityThreatQuarantineForTests();
    home = mkdtempSync(join(tmpdir(), 'mastyf-ai-sec-dash-'));
    process.env.MASTYF_AI_HOME = home;
  });

  afterEach(() => {
    resetSecurityThreatQuarantineForTests();
    if (prevHome === undefined) delete process.env.MASTYF_AI_HOME;
    else process.env.MASTYF_AI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('hides sibling threats that share type and source after one quarantine', () => {
    const rowA: SecurityThreatRow = {
      id: 'THR-1',
      threatKey: 'block:fs:read:2026-07-03 10:55:17',
      type: 'Semantic Prompt Injection',
      source: '10.13.195.218',
      severity: 'critical',
      status: 'blocked',
    };
    const rowB: SecurityThreatRow = {
      id: 'THR-2',
      threatKey: 'block:fs:read:2026-07-03 10:55:19',
      type: 'Semantic Prompt Injection',
      source: '10.13.195.218',
      severity: 'critical',
      status: 'blocked',
    };
    expect(threatDisplayFingerprint(rowA)).toBe(threatDisplayFingerprint(rowB));

    const store = getSecurityThreatQuarantine('default');
    store.quarantine(rowA);

    const visible = filterVisibleMonitorThreats([rowA, rowB], store);
    expect(visible).toEqual([]);
  });
});
