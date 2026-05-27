/**
 * Cluster-aware rug-pull fingerprint registry (Redis when REDIS_URL set).
 */
import { LRUCache } from 'lru-cache';
import { Logger } from '../utils/logger.js';
import { getSharedRedisClient, isRedisConfigured } from '../utils/redis-client.js';

function localTtlMs(): number {
  const sec = parseInt(process.env['GUARDIAN_RUGPULL_LOCAL_TTL_SEC'] || '3600', 10);
  return (Number.isFinite(sec) && sec > 0 ? sec : 3600) * 1000;
}

const localAlerts = new LRUCache<string, string>({
  max: 5000,
  ttl: localTtlMs(),
  updateAgeOnGet: false,
});

function clusterKey(serverName: string, tenantId: string): string {
  return `rugpull:${tenantId}:${serverName}`;
}

export function clearLocalRugPullAlertsForTests(): void {
  localAlerts.clear();
}

/** Ops: clear in-process rug-pull flags on proxy start when env set. */
export function maybeClearRugPullOnStart(): void {
  if (process.env['GUARDIAN_RUGPULL_CLEAR_ON_START'] === 'true') {
    localAlerts.clear();
    Logger.info('[rug-pull] Cleared local rug-pull alerts (GUARDIAN_RUGPULL_CLEAR_ON_START)');
  }
}

export async function publishRugPullAlert(
  serverName: string,
  tenantId: string,
  fingerprint: string,
): Promise<void> {
  const key = clusterKey(serverName, tenantId);
  localAlerts.set(key, fingerprint);
  if (!isRedisConfigured()) return;
  try {
    const client = getSharedRedisClient();
    const ttlSec = Math.max(60, Math.floor(localTtlMs() / 1000));
    await client.set(key, fingerprint, 'EX', ttlSec);
    await client.publish(
      `guardian:rugpull:${tenantId}`,
      JSON.stringify({ serverName, fingerprint }),
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.warn(`[rug-pull] Redis publish failed: ${msg}`);
  }
}

export async function isClusterRugPullActive(
  serverName: string,
  tenantId: string,
): Promise<boolean> {
  const key = clusterKey(serverName, tenantId);
  if (localAlerts.has(key)) return true;
  if (!isRedisConfigured()) return false;
  try {
    const client = getSharedRedisClient();
    const val = await client.get(key);
    return Boolean(val);
  } catch {
    return false;
  }
}

/** Ops: clear rug-pull flag for a server/tenant (local + Redis). */
export async function clearRugPullAlert(
  serverName: string,
  tenantId: string,
): Promise<void> {
  const key = clusterKey(serverName, tenantId);
  localAlerts.delete(key);
  if (!isRedisConfigured()) return;
  try {
    const client = getSharedRedisClient();
    await client.del(key);
    Logger.info(`[rug-pull] Cleared cluster alert for ${tenantId}/${serverName}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.warn(`[rug-pull] Redis clear failed: ${msg}`);
  }
}
