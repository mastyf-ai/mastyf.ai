/**
 * A1 — Cross-replica fleet chain event sync via Redis (multi-pod / multi-region K8s).
 */
import { isRedisConfigured, createRedisClient } from '../../utils/redis-client.js';
import { Logger } from '../../utils/logger.js';
const SESSION_PREFIX = 'mastyf-ai:fleet:session:';
const TTL_SEC = 86_400;
let redisSingleton = null;
function redis() {
    if (!redisSingleton)
        redisSingleton = createRedisClient();
    return redisSingleton;
}
export function fleetRegion() {
    return process.env.MASTYF_AI_FLEET_REGION?.trim().toUpperCase() || 'LOCAL';
}
export function fleetPeerRegions() {
    const peers = process.env.MASTYF_AI_FLEET_PEER_REGIONS?.split(',').map(r => r.trim().toUpperCase()).filter(Boolean) ?? [];
    const local = fleetRegion();
    return [...new Set([local, ...peers])];
}
function sessionKey(globalSessionId, region = fleetRegion()) {
    return `${SESSION_PREFIX}${region}:${globalSessionId}`;
}
export function isFleetRedisSyncEnabled() {
    return isRedisConfigured() && process.env.MASTYF_AI_FLEET_CHAIN_REDIS !== 'false';
}
export async function publishFleetEventToRedis(evt) {
    if (!isFleetRedisSyncEnabled())
        return;
    try {
        const payload = { ...evt, region: fleetRegion() };
        const key = sessionKey(evt.globalSessionId);
        const client = redis();
        await client.lpush(key, JSON.stringify(payload));
        await client.ltrim(key, 0, 299);
        await client.expire(key, TTL_SEC);
    }
    catch (err) {
        Logger.debug(`[FleetChainRedis] publish failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
export async function listFleetEventsFromRedis(globalSessionId) {
    if (!isFleetRedisSyncEnabled())
        return [];
    const regions = fleetPeerRegions();
    const merged = [];
    try {
        const client = redis();
        for (const region of regions) {
            const key = sessionKey(globalSessionId, region);
            const rows = await client.lrange(key, 0, 299);
            for (const r of rows) {
                try {
                    merged.push(JSON.parse(r));
                }
                catch {
                    // skip malformed
                }
            }
        }
        merged.sort((a, b) => a.timestamp - b.timestamp);
        return merged;
    }
    catch {
        return merged;
    }
}
//# sourceMappingURL=fleet-chain-redis.js.map