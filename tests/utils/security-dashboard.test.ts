import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  buildSecurityDashboard,
  collectBulkQuarantineTargets,
  filterRelatedMonitorThreats,
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

describe('filterRelatedMonitorThreats', () => {
  const rowA: SecurityThreatRow = {
    id: 'THR-1',
    threatKey: 'block:fs:read:2026-07-01 10:55:17',
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
  const rowOther: SecurityThreatRow = {
    id: 'THR-3',
    threatKey: 'block:db:query:2026-07-03 10:55:19',
    type: 'SQL Injection Attempt',
    source: '10.1.2.3',
    severity: 'high',
    status: 'blocked',
  };

  it('returns all fingerprint siblings present in the candidate list', () => {
    const related = filterRelatedMonitorThreats([rowA, rowB, rowOther], rowA);
    expect(related).toEqual([rowA, rowB]);
  });

  it('returns only in-window siblings when the candidate list is window-scoped', () => {
    const related = filterRelatedMonitorThreats([rowB, rowOther], rowB);
    expect(related).toEqual([rowB]);
  });

  it('falls back to the anchor when no siblings are in the candidate list', () => {
    const related = filterRelatedMonitorThreats([rowOther], rowA);
    expect(related).toEqual([rowA]);
  });
});

describe('collectBulkQuarantineTargets', () => {
  it('archives every high/critical row for visible fingerprint groups', () => {
    const visible: SecurityThreatRow[] = [
      {
        id: 'THR-1',
        threatKey: 'semantic:a',
        type: 'Semantic Prompt Injection',
        source: '10.1.1.1',
        severity: 'critical',
        status: 'blocked',
      },
    ];
    const candidates: SecurityThreatRow[] = [
      ...visible,
      {
        id: 'THR-2',
        threatKey: 'semantic:b',
        type: 'Semantic Prompt Injection',
        source: '10.1.1.1',
        severity: 'critical',
        status: 'blocked',
      },
      {
        id: 'THR-3',
        threatKey: 'block:other',
        type: 'SQL Injection Attempt',
        source: '10.2.2.2',
        severity: 'high',
        status: 'blocked',
      },
    ];
    const targets = collectBulkQuarantineTargets(candidates, visible);
    expect(targets.map((t) => t.threatKey).sort()).toEqual(['semantic:a', 'semantic:b']);
  });
});
