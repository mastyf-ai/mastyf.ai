import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  clearLocalRugPullAlertsForTests,
  clearRugPullAlert,
  isClusterRugPullActive,
  publishRugPullAlert,
} from '../../src/proxy/rug-pull-cluster.js';

describe('rug-pull-cluster', () => {
  afterEach(() => {
    clearLocalRugPullAlertsForTests();
    vi.unstubAllEnvs();
  });

  it('stores local alert with TTL semantics', async () => {
    vi.stubEnv('REDIS_URL', '');
    await publishRugPullAlert('filesystem', 'default', 'abc123');
    expect(await isClusterRugPullActive('filesystem', 'default')).toBe(true);
    expect(await isClusterRugPullActive('filesystem', 'other')).toBe(false);
  });

  it('clearRugPullAlert removes local flag', async () => {
    vi.stubEnv('REDIS_URL', '');
    await publishRugPullAlert('fs', 'default', 'hash1');
    await clearRugPullAlert('fs', 'default');
    expect(await isClusterRugPullActive('fs', 'default')).toBe(false);
  });
});
