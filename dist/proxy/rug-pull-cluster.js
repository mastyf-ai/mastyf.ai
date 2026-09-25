/**
 * Cluster-aware rug-pull fingerprint registry (Redis when REDIS_URL set).
 */
import { LRUCache } from 'lru-cache';
import { Logger } from '../utils/logger.js';
import { getSharedRedisClient, isRedisConfigured } from '../utils/redis-client.js';
function localTtlMs() {
    const sec = parseInt(process.env['MASTYF_AI_RUGPULL_LOCAL_TTL_SEC'] || '3600', 10);
    return (Number.isFinite(sec) && sec > 0 ? sec : 3600) * 1000;
}
const localAlerts = new LRUCache({
    max: 5000,
    ttl: localTtlMs(),
    updateAgeOnGet: false,
});
function clusterKey(serverName, tenantId) {
    return `rugpull:${tenantId}:${serverName}`;
}
export function clearLocalRugPullAlertsForTests() {
    localAlerts.clear();
}
/** Ops: clear in-process rug-pull flags on proxy start when env set. */
export function maybeClearRugPullOnStart() {
    if (process.env['MASTYF_AI_RUGPULL_CLEAR_ON_START'] === 'true') {
        localAlerts.clear();
        Logger.info('[rug-pull] Cleared local rug-pull alerts (MASTYF_AI_RUGPULL_CLEAR_ON_START)');
    }
}
export async function publishRugPullAlert(serverName, tenantId, fingerprint) {
    const key = clusterKey(serverName, tenantId);
    localAlerts.set(key, fingerprint);
    if (!isRedisConfigured())
        return;
    try {
        const client = getSharedRedisClient();
        const ttlSec = Math.max(60, Math.floor(localTtlMs() / 1000));
        await client.set(key, fingerprint, 'EX', ttlSec);
        await client.publish(`mastyf-ai:rugpull:${tenantId}`, JSON.stringify({ serverName, fingerprint }));
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.warn(`[rug-pull] Redis publish failed: ${msg}`);
    }
}
export async function isClusterRugPullActive(serverName, tenantId) {
    const key = clusterKey(serverName, tenantId);
    if (localAlerts.has(key))
        return true;
    if (!isRedisConfigured())
        return false;
    try {
        const client = getSharedRedisClient();
        const val = await client.get(key);
        return Boolean(val);
    }
    catch {
        return false;
    }
}
/** Ops: clear rug-pull flag for a server/tenant (local + Redis). */
export async function clearRugPullAlert(serverName, tenantId) {
    const key = clusterKey(serverName, tenantId);
    localAlerts.delete(key);
    if (!isRedisConfigured())
        return;
    try {
        const client = getSharedRedisClient();
        await client.del(key);
        Logger.info(`[rug-pull] Cleared cluster alert for ${tenantId}/${serverName}`);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.warn(`[rug-pull] Redis clear failed: ${msg}`);
    }
}
//# sourceMappingURL=rug-pull-cluster.js.map