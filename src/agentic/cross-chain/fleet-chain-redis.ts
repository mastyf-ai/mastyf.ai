/**
 * A1 — Cross-replica fleet chain event sync via Redis (multi-pod / multi-region K8s).
 */
import { isRedisConfigured, createRedisClient } from '../../utils/redis-client.js';
import { Logger } from '../../utils/logger.js';

const SESSION_PREFIX = 'guardian:fleet:session:';
const TTL_SEC = 86_400;

let redisSingleton: ReturnType<typeof createRedisClient> | null = null;

function redis() {
  if (!redisSingleton) redisSingleton = createRedisClient();
  return redisSingleton;
}

export function fleetRegion(): string {
  return process.env.GUARDIAN_FLEET_REGION?.trim().toUpperCase() || 'LOCAL';
}

export function fleetPeerRegions(): string[] {
  const peers = process.env.GUARDIAN_FLEET_PEER_REGIONS?.split(',').map(r => r.trim().toUpperCase()).filter(Boolean) ?? [];
  const local = fleetRegion();
  return [...new Set([local, ...peers])];
}

function sessionKey(globalSessionId: string, region = fleetRegion()): string {
  return `${SESSION_PREFIX}${region}:${globalSessionId}`;
}

export function isFleetRedisSyncEnabled(): boolean {
  return isRedisConfigured() && process.env.GUARDIAN_FLEET_CHAIN_REDIS !== 'false';
}

export interface FleetRedisEvent {
  globalSessionId: string;
  agentId: string;
  serverName: string;
  toolName: string;
  eventType: string;
  blocked: boolean;
  timestamp: number;
  region?: string;
  edgeJson?: Record<string, unknown>;
}

export async function publishFleetEventToRedis(evt: FleetRedisEvent): Promise<void> {
  if (!isFleetRedisSyncEnabled()) return;
  try {
    const payload: FleetRedisEvent = { ...evt, region: fleetRegion() };
    const key = sessionKey(evt.globalSessionId);
    const client = redis() as import('ioredis').Redis;
    await client.lpush(key, JSON.stringify(payload));
    await client.ltrim(key, 0, 299);
    await client.expire(key, TTL_SEC);
  } catch (err: unknown) {
    Logger.debug(`[FleetChainRedis] publish failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function listFleetEventsFromRedis(globalSessionId: string): Promise<FleetRedisEvent[]> {
  if (!isFleetRedisSyncEnabled()) return [];
  const regions = fleetPeerRegions();
  const merged: FleetRedisEvent[] = [];
  try {
    const client = redis() as import('ioredis').Redis;
    for (const region of regions) {
      const key = sessionKey(globalSessionId, region);
      const rows = await client.lrange(key, 0, 299);
      for (const r of rows) {
        try {
          merged.push(JSON.parse(r) as FleetRedisEvent);
        } catch {
          // skip malformed
        }
      }
    }
    merged.sort((a, b) => a.timestamp - b.timestamp);
    return merged;
  } catch {
    return merged;
  }
}
