import { describe, expect, it, vi, afterEach } from 'vitest';
import { runEnterpriseSecurityPreflight } from '../../src/utils/enterprise-bootstrap.js';

describe('enterprise validation matrix', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails preflight when enterprise strict multi-replica without Redis', () => {
    vi.stubEnv('GUARDIAN_ENTERPRISE_MODE', 'true');
    vi.stubEnv('GUARDIAN_STRICT_MODE', 'true');
    vi.stubEnv('GUARDIAN_REPLICA_COUNT', '2');
    vi.stubEnv('REDIS_URL', '');
    vi.stubEnv('GUARDIAN_CI_BYPASS_LICENSE', '');
    vi.stubEnv('GUARDIAN_DEV_UNLOCK_ALL', '');
    expect(() => runEnterpriseSecurityPreflight()).toThrow(/REDIS_URL/);
  });
});
