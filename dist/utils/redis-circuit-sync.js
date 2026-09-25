/**
 * Optional Redis sync for upstream circuit breaker state across replicas.
 */
import { isRedisConfigured, createRedisClient } from './redis-client.js';
import * as Metrics from './metrics.js';
let redisSingleton = null;
function redis() {
    if (!redisSingleton)
        redisSingleton = createRedisClient();
    return redisSingleton;
}
const PREFIX = 'mastyf-ai:cb:';
const PUBSUB_CHANNEL = 'mastyf-ai:cb:events';
const TTL_SEC = 120;
let subscriberStarted = false;
const remoteListeners = new Map();
function recordSyncMetric(op, ok) {
    Metrics.circuitBreakerSyncTotal.inc({ op, result: ok ? 'ok' : 'error' });
}
export function subscribeCircuitRedisUpdates(key, onUpdate) {
    if (!isRedisConfigured())
        return () => { };
    startCircuitRedisSubscriber();
    let set = remoteListeners.get(key);
    if (!set) {
        set = new Set();
        remoteListeners.set(key, set);
    }
    set.add(onUpdate);
    return () => {
        set?.delete(onUpdate);
        if (set && set.size === 0)
            remoteListeners.delete(key);
    };
}
function startCircuitRedisSubscriber() {
    if (subscriberStarted || !isRedisConfigured())
        return;
    subscriberStarted = true;
    try {
        const sub = createRedisClient();
        sub.on('message', (channel, message) => {
            if (channel !== PUBSUB_CHANNEL)
                return;
            try {
                const parsed = JSON.parse(message);
                if (!parsed.key || !parsed.snap)
                    return;
                recordSyncMetric('pubsub', true);
                const listeners = remoteListeners.get(parsed.key);
                if (listeners) {
                    for (const fn of listeners)
                        fn(parsed.snap);
                }
            }
            catch {
                recordSyncMetric('pubsub', false);
            }
        });
        void sub.subscribe(PUBSUB_CHANNEL).catch(() => {
            subscriberStarted = false;
        });
    }
    catch {
        subscriberStarted = false;
    }
}
export async function loadCircuitFromRedis(key) {
    if (!isRedisConfigured())
        return null;
    try {
        const raw = await redis().get(`${PREFIX}${key}`);
        if (!raw) {
            recordSyncMetric('load', true);
            return null;
        }
        recordSyncMetric('load', true);
        return JSON.parse(raw);
    }
    catch {
        recordSyncMetric('load', false);
        return null;
    }
}
export async function saveCircuitToRedis(key, snap) {
    if (!isRedisConfigured())
        return;
    try {
        await redis().set(`${PREFIX}${key}`, JSON.stringify(snap), 'EX', TTL_SEC);
        await redis().publish(PUBSUB_CHANNEL, JSON.stringify({ key, snap }));
        recordSyncMetric('save', true);
    }
    catch {
        recordSyncMetric('save', false);
    }
}
/** @internal */
export function resetCircuitRedisSyncForTests() {
    subscriberStarted = false;
    remoteListeners.clear();
    redisSingleton = null;
}
//# sourceMappingURL=redis-circuit-sync.js.map