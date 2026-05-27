import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ThreatIntel', () => {
  let dir: string;
  let statePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'threat-intel-'));
    statePath = join(dir, '.threat-state.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads legacy ids-only state and exposes status with stub entries', async () => {
    writeFileSync(statePath, JSON.stringify({
      ids: ['osv-GHSA-test', 'gh-GHSA-demo'],
      updated: '2026-05-16T12:00:00.000Z',
    }));

    const { ThreatIntel } = await import('../../src/ai/threat-intel.js');
    const ti = new ThreatIntel(statePath);
    const status = ti.getStatus();

    expect(status.threats).toBe(0);
    expect(status.knownIds).toEqual([]);
    expect(status.entries).toHaveLength(0);
  });

  it('persists entry metadata on diffFeed', async () => {
    const { ThreatIntel } = await import('../../src/ai/threat-intel.js');
    const ti = new ThreatIntel(statePath);
    const entry = {
      id: 'osv-GHSA-new',
      source: 'OSV' as const,
      severity: 'HIGH' as const,
      description: 'Test advisory',
      remediation: 'Upgrade',
      publishedAt: '2026-05-19T00:00:00.000Z',
    };

    const fresh = ti.diffFeed([entry]);
    expect(fresh).toHaveLength(1);

    const status = ti.getStatus();
    expect(status.threats).toBe(1);
    expect(status.entries[0]?.description).toBe('Test advisory');
    expect(status.entries[0]?.firstSeenAt).toBeTruthy();

    expect(existsSync(statePath)).toBe(true);
    const saved = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(saved.entries).toHaveLength(1);
    expect(saved.updated).toBeTruthy();
  });

  it('dismiss hides entry from active status', async () => {
    const { ThreatIntel } = await import('../../src/ai/threat-intel.js');
    const ti = new ThreatIntel(statePath);
    ti.diffFeed([
      {
        id: 'osv-GHSA-dismiss',
        source: 'OSV',
        severity: 'HIGH',
        description: 'Dismiss me',
        remediation: 'Patch',
        publishedAt: '2026-05-19T00:00:00.000Z',
      },
    ]);
    const dismissed = ti.dismissThreat('osv-GHSA-dismiss', 'tester');
    expect(dismissed.ok).toBe(true);
    const status = ti.getStatus();
    expect(status.entries.some((e) => e.id === 'osv-GHSA-dismiss')).toBe(false);
    expect(status.suppressed).toBe(1);
  });

  it('quarantine archives and suppresses threat entries', async () => {
    const { ThreatIntel } = await import('../../src/ai/threat-intel.js');
    const ti = new ThreatIntel(statePath);
    ti.diffFeed([
      {
        id: 'osv-GHSA-quarantine',
        source: 'OSV',
        severity: 'CRITICAL',
        description: 'Quarantine me',
        remediation: 'Patch now',
        publishedAt: '2026-05-19T00:00:00.000Z',
        affectedPackage: '@modelcontextprotocol/sdk',
      },
    ]);
    const quarantined = ti.quarantineThreat('osv-GHSA-quarantine', {
      operator: 'operator-1',
      appliedRuleName: 'threat-osv-GHSA-quarantine',
      policyPath: 'default-policy.yaml',
    });
    expect(quarantined.ok).toBe(true);
    const status = ti.getStatus();
    expect(status.entries.some((e) => e.id === 'osv-GHSA-quarantine')).toBe(false);
    const archived = ti.listQuarantined(30);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.id).toBe('osv-GHSA-quarantine');
    expect(archived[0]?.appliedRuleName).toBe('threat-osv-GHSA-quarantine');
  });

  it('purges quarantine archive entries older than 30 days', async () => {
    const stale = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(statePath, JSON.stringify({
      ids: ['osv-old'],
      entries: [
        {
          id: 'osv-old',
          source: 'OSV',
          severity: 'HIGH',
          description: 'Old',
          remediation: 'Patch',
          publishedAt: stale,
          firstSeenAt: stale,
        },
      ],
      quarantineArchive: [
        {
          id: 'osv-old',
          source: 'OSV',
          severity: 'HIGH',
          description: 'Old',
          remediation: 'Patch',
          publishedAt: stale,
          quarantinedAt: stale,
        },
      ],
    }));
    const { ThreatIntel } = await import('../../src/ai/threat-intel.js');
    const ti = new ThreatIntel(statePath);
    expect(ti.listQuarantined(30)).toHaveLength(0);
  });
});
