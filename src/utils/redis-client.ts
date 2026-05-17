import { Redis, Cluster, type RedisOptions } from 'ioredis';
import { Logger } from './logger.js';

export interface RedisClientOptions {
  maxRetriesPerRequest?: number;
  lazyConnect?: boolean;
  connectTimeout?: number;
}

/** True when any Redis HA env is set (single, Sentinel, or Cluster). */
export function isRedisConfigured(): boolean {
  return !!(
    process.env['REDIS_URL'] ||
    process.env['REDIS_SENTINELS'] ||
    process.env['REDIS_CLUSTER_NODES']
  );
}

/** Parse `host:port,host:port` sentinel endpoints. */
export function parseSentinelEndpoints(raw: string): Array<{ host: string; port: number }> {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, portStr] = entry.split(':');
      const port = parseInt(portStr || '26379', 10);
      if (!host || !Number.isFinite(port)) {
        throw new Error(`Invalid sentinel endpoint: ${entry}`);
      }
      return { host, port };
    });
}

/** Parse `host:port,host:port` cluster node list. */
export function parseClusterNodes(raw: string): Array<{ host: string; port: number }> {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, portStr] = entry.split(':');
      const port = parseInt(portStr || '6379', 10);
      if (!host || !Number.isFinite(port)) {
        throw new Error(`Invalid cluster node: ${entry}`);
      }
      return { host, port };
    });
}

export type RedisConnectionMode = 'url' | 'sentinel' | 'cluster' | 'none';

export function getRedisConnectionMode(): RedisConnectionMode {
  if (process.env['REDIS_CLUSTER_NODES']) return 'cluster';
  if (process.env['REDIS_SENTINELS']) return 'sentinel';
  if (process.env['REDIS_URL']) return 'url';
  return 'none';
}

export function getRedisConnectionLabel(): string {
  const mode = getRedisConnectionMode();
  if (mode === 'url') return process.env['REDIS_URL'] || 'redis://localhost:6379';
  if (mode === 'sentinel') {
    const master = process.env['REDIS_SENTINEL_MASTER_NAME'] || 'mymaster';
    return `sentinel:${master}(${process.env['REDIS_SENTINELS']})`;
  }
  if (mode === 'cluster') return `cluster:(${process.env['REDIS_CLUSTER_NODES']})`;
  return 'none';
}

function baseOptions(options?: RedisClientOptions): RedisOptions {
  return {
    maxRetriesPerRequest: options?.maxRetriesPerRequest ?? 2,
    lazyConnect: options?.lazyConnect ?? false,
    connectTimeout: options?.connectTimeout,
    password: process.env['REDIS_PASSWORD'] || undefined,
  };
}

/**
 * Create an ioredis client for single URL, Sentinel, or Cluster mode.
 * Priority: REDIS_CLUSTER_NODES > REDIS_SENTINELS > REDIS_URL.
 */
export function createRedisClient(options?: RedisClientOptions): Redis | Cluster {
  const opts = baseOptions(options);

  const clusterNodes = process.env['REDIS_CLUSTER_NODES'];
  if (clusterNodes) {
    const nodes = parseClusterNodes(clusterNodes);
    Logger.info(`[redis] Cluster mode: ${nodes.length} node(s)`);
    return new Cluster(nodes, {
      redisOptions: opts,
      clusterRetryStrategy: (times) => Math.min(times * 200, 3000),
    });
  }

  const sentinels = process.env['REDIS_SENTINELS'];
  if (sentinels) {
    const endpoints = parseSentinelEndpoints(sentinels);
    const name = process.env['REDIS_SENTINEL_MASTER_NAME'] || 'mymaster';
    Logger.info(`[redis] Sentinel mode: master=${name}, sentinels=${endpoints.length}`);
    return new Redis({
      ...opts,
      sentinels: endpoints,
      name,
    });
  }

  const url = process.env['REDIS_URL'] || 'redis://localhost:6379';
  Logger.info(`[redis] URL mode: ${url}`);
  return new Redis(url, opts);
}
