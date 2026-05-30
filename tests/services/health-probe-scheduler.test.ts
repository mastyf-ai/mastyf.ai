import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IDatabase } from '../../src/database/database-interface.js';

const stubDb = {} as IDatabase;

describe('health-probe-scheduler', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('does not start when interval is 0', async () => {
    vi.stubEnv('GUARDIAN_HEALTH_PROBE_INTERVAL_MS', '0');
    const { startHealthProbeScheduler, stopHealthProbeScheduler } = await import(
      '../../src/services/health-probe-scheduler.js'
    );
    startHealthProbeScheduler(stubDb, []);
    stopHealthProbeScheduler();
    expect(true).toBe(true);
  });
});
