/**
 * Distributed session flow history — in-memory LRU with optional Redis for multi-replica deployments.
 */
import { LRUCache } from 'lru-cache';
import { isRedisConfigured, getSharedRedisClient } from '../utils/redis-client.js';
import { Logger } from '../utils/logger.js';
import * as Metrics from '../utils/metrics.js';

let sessionFlowBackendLogged = false;

function logSessionFlowBackend(): void {
  if (sessionFlowBackendLogged) return;
  sessionFlowBackendLogged = true;
  const redis = isRedisConfigured();
  Metrics.sessionFlowBackend.set(redis ? 1 : 0);
  if (process.env['GUARDIAN_ENTERPRISE_MODE'] === 'true' && !redis) {
    Logger.error(
      '[SessionFlow] GUARDIAN_ENTERPRISE_MODE=true without REDIS_URL — session flow is per-process only',
    );
  } else {
    Logger.info(`[SessionFlow] backend=${redis ? 'redis' : 'memory'}`);
  }
}

const FLOW_WINDOW_MS = 5 * 60 * 1000;
const MAX_HISTORY = 24;
const REDIS_PREFIX = 'mcpg:flow:';

export interface FlowEvent {
  toolName: string;
  sensitiveRead: boolean;
  dataAccess: boolean;
  at: number;
  /** Redacted tool arguments for chain classification and intent graph replay. */
  argumentsSnapshot?: Record<string, unknown>;
}

const memoryStore = new LRUCache<string, FlowEvent[]>({
  max: 20_000,
  ttl: FLOW_WINDOW_MS,
  updateAgeOnGet: true,
});

function prune(events: FlowEvent[], now: number): FlowEvent[] {
  return events.filter((e) => now - e.at <= FLOW_WINDOW_MS).slice(-MAX_HISTORY);
}

async function redisGet(key: string): Promise<FlowEvent[]> {
  if (!isRedisConfigured()) return [];
  try {
    const redis = getSharedRedisClient();
    const raw = await redis.get(`${REDIS_PREFIX}${key}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FlowEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    Logger.warn(`[SessionFlow] Redis get failed: ${(err as Error).message}`);
    return [];
  }
}

async function redisSet(key: string, events: FlowEvent[]): Promise<void> {
  if (!isRedisConfigured()) return;
  try {
    const redis = getSharedRedisClient();
    await redis.set(
      `${REDIS_PREFIX}${key}`,
      JSON.stringify(events),
      'PX',
      FLOW_WINDOW_MS,
    );
  } catch (err) {
    Logger.warn(`[SessionFlow] Redis set failed: ${(err as Error).message}`);
  }
}

export async function getFlowHistory(sessionKey: string): Promise<FlowEvent[]> {
  logSessionFlowBackend();
  const now = Date.now();
  if (isRedisConfigured()) {
    const fromRedis = await redisGet(sessionKey);
    const pruned = prune(fromRedis, now);
    memoryStore.set(sessionKey, pruned);
    return pruned;
  }
  return prune(memoryStore.get(sessionKey) ?? [], now);
}

export function getFlowHistorySync(sessionKey: string): FlowEvent[] {
  const now = Date.now();
  return prune(memoryStore.get(sessionKey) ?? [], now);
}

export async function appendFlowEvent(sessionKey: string, event: FlowEvent): Promise<void> {
  const now = Date.now();
  event.at = event.at || now;
  const existing = isRedisConfigured()
    ? await getFlowHistory(sessionKey)
    : getFlowHistorySync(sessionKey);
  existing.push(event);
  const pruned = prune(existing, now);
  memoryStore.set(sessionKey, pruned);
  await redisSet(sessionKey, pruned);
}

export function appendFlowEventSync(sessionKey: string, event: FlowEvent): void {
  const now = Date.now();
  event.at = event.at || now;
  const existing = getFlowHistorySync(sessionKey);
  existing.push(event);
  memoryStore.set(sessionKey, prune(existing, now));
}

/** Mark that a prior tool response contained sensitive data (response-based chain). */
export function recordSensitiveResponseAccess(sessionKey: string, toolName: string): void {
  appendFlowEventSync(sessionKey, {
    toolName,
    sensitiveRead: true,
    dataAccess: true,
    at: Date.now(),
  });
}

export function resetSessionFlowStore(): void {
  memoryStore.clear();
}

/** Alias for harness / corpus parity. */
export const resetSessionFlowHistory = resetSessionFlowStore;
