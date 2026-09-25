/**
 * Registration-time tool corpus gate — blocks tools/call for tools marked critical at last tools/list scan.
 */
import { LRUCache } from 'lru-cache';
import { scanTool } from '@mastyf_ai/core';
import { Logger } from '../utils/logger.js';
const criticalToolsByServer = new LRUCache({
    max: 500,
    ttl: 1000 * 60 * 60 * 6,
});
let scanInFlight = new Set();
export function isToolRegistrationGateEnabled() {
    return process.env['MASTYF_AI_BLOCK_CRITICAL_TOOLS'] === 'true';
}
/** Queue async corpus scan when tools/list is observed. */
export function registerToolsFromList(serverName, tools) {
    if (!isToolRegistrationGateEnabled() || !tools.length)
        return;
    const key = serverName.trim();
    if (scanInFlight.has(key))
        return;
    scanInFlight.add(key);
    void (async () => {
        try {
            const critical = new Set();
            const scanOpts = {
                skipSemantic: process.env['MASTYF_AI_REGISTRATION_GATE_SKIP_SEMANTIC'] === 'true',
            };
            for (const tool of tools.slice(0, 200)) {
                const result = await scanTool(tool, scanOpts);
                if (result.status === 'critical') {
                    critical.add(tool.name);
                }
            }
            criticalToolsByServer.set(key, critical);
            if (critical.size > 0) {
                Logger.warn(`[registration-gate] ${key}: ${critical.size} critical tool(s) flagged at catalog scan`);
            }
        }
        catch (err) {
            Logger.debug(`[registration-gate] scan failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            scanInFlight.delete(key);
        }
    })();
}
export function evaluateToolRegistrationGate(serverName, toolName) {
    if (!isToolRegistrationGateEnabled())
        return { block: false };
    const critical = criticalToolsByServer.get(serverName.trim());
    if (!critical?.has(toolName))
        return { block: false };
    return {
        block: true,
        rule: 'registration-corpus-critical',
        reason: `Tool "${toolName}" flagged critical at registration scan`,
    };
}
/** @internal */
export function resetToolRegistrationGateForTests() {
    criticalToolsByServer.clear();
    scanInFlight = new Set();
}
//# sourceMappingURL=tool-registration-gate.js.map