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
});
