import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dashboardApiKeyPath,
  ensureLocalDashboardApiKey,
  readDashboardApiKeyFile,
} from '../../src/utils/dashboard-api-key.js';

describe('local dashboard API key', () => {
  const prevKey = process.env.DASHBOARD_API_KEY;
  const prevHome = process.env.MASTYF_HOME;

  afterEach(() => {
    if (prevKey === undefined) delete process.env.DASHBOARD_API_KEY;
    else process.env.DASHBOARD_API_KEY = prevKey;
    if (prevHome === undefined) delete process.env.MASTYF_HOME;
    else process.env.MASTYF_HOME = prevHome;
  });

  it('creates a file key when env is empty and reuses it', () => {
    const home = mkdtempSync(join(tmpdir(), 'mastyf-dash-key-'));
    process.env.MASTYF_HOME = home;
    delete process.env.DASHBOARD_API_KEY;
    const first = ensureLocalDashboardApiKey();
    const second = ensureLocalDashboardApiKey();
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(second).toBe(first);
    expect(readDashboardApiKeyFile(home)).toBe(first);
    expect(readFileSync(dashboardApiKeyPath(home), 'utf8').trim()).toBe(first);
    expect(first).not.toMatch(/\s/);
  });

  it('prefers DASHBOARD_API_KEY env over the file', () => {
    const home = mkdtempSync(join(tmpdir(), 'mastyf-dash-key-env-'));
    process.env.MASTYF_HOME = home;
    process.env.DASHBOARD_API_KEY = 'from-env-dashboard-key-16';
    expect(ensureLocalDashboardApiKey()).toBe('from-env-dashboard-key-16');
    expect(readDashboardApiKeyFile(home)).toBeNull();
  });
});
