import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseSentinelEndpoints,
  parseClusterNodes,
  getRedisConnectionMode,
  isRedisConfigured,
} from '../../src/utils/redis-client.js';

describe('redis-client', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_SENTINELS;
    delete process.env.REDIS_CLUSTER_NODES;
    delete process.env.REDIS_SENTINEL_MASTER_NAME;
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('parseSentinelEndpoints splits host:port pairs', () => {
    const nodes = parseSentinelEndpoints('sentinel-0:26379,sentinel-1:26380');
    expect(nodes).toEqual([
      { host: 'sentinel-0', port: 26379 },
      { host: 'sentinel-1', port: 26380 },
    ]);
  });

  it('parseClusterNodes defaults port 6379', () => {
    expect(parseClusterNodes('redis-0,redis-1:6380')).toEqual([
      { host: 'redis-0', port: 6379 },
      { host: 'redis-1', port: 6380 },
    ]);
  });

  it('getRedisConnectionMode respects priority cluster > sentinel > url', () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    expect(getRedisConnectionMode()).toBe('url');

    process.env.REDIS_SENTINELS = 's0:26379';
    expect(getRedisConnectionMode()).toBe('sentinel');

    process.env.REDIS_CLUSTER_NODES = 'n0:6379';
    expect(getRedisConnectionMode()).toBe('cluster');
  });

  it('isRedisConfigured is true for any mode', () => {
    expect(isRedisConfigured()).toBe(false);
    process.env.REDIS_URL = 'redis://x';
    expect(isRedisConfigured()).toBe(true);
  });
});
