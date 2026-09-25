/**
 * Reuse compiled PolicyEngine instances across hot-reloads when config hash is unchanged.
 */
import { createHash } from 'crypto';
import { PolicyEngine } from './policy-engine.js';
const cache = new Map();
const MAX_CACHE = 32;
function configHash(config) {
    return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
export function getOrCreatePolicyEngine(config) {
    const key = configHash(config);
    const hit = cache.get(key);
    if (hit)
        return hit;
    const engine = new PolicyEngine(config);
    if (cache.size >= MAX_CACHE) {
        const first = cache.keys().next().value;
        if (first)
            cache.delete(first);
    }
    cache.set(key, engine);
    return engine;
}
/** @internal */
export function resetPolicyEngineCacheForTests() {
    cache.clear();
}
//# sourceMappingURL=policy-engine-cache.js.map