/**
 * Global registry for the active ProxyManager instance.
 * Set from cli.ts after manager.startAll(); consumed by rug-pull-scanner
 * to report the true server count instead of only servers with events.
 *
 * In fleet mode, each child process only has 1 server. To report the
 * full fleet size, we also read fleet-state.json as a fallback.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
let activeManager = null;
export function registerProxyManager(mgr) {
    activeManager = mgr;
}
export function getActiveProxyManager() {
    return activeManager;
}
function fleetServerCount() {
    try {
        const fleetPath = join(homedir(), '.mastyf-ai', 'fleet-state.json');
        if (!existsSync(fleetPath))
            return 0;
        const state = JSON.parse(readFileSync(fleetPath, 'utf-8'));
        return Array.isArray(state?.servers) ? state.servers.length : 0;
    }
    catch {
        return 0;
    }
}
/** Total number of registered proxy servers (stdio + SSE + streamable + WS). */
export function getRegisteredServerCount() {
    const localCount = activeManager
        ? (() => {
            const s = activeManager.getProxyStats();
            return s.stdioCount + s.sseCount + s.streamableCount + s.wsCount;
        })()
        : 0;
    const fleetCount = fleetServerCount();
    return Math.max(localCount, fleetCount);
}
//# sourceMappingURL=proxy-manager-registry.js.map