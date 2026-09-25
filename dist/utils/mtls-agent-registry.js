import { loadMtlsConfig, createMtlsAgent } from './mtls-config.js';
import { Logger } from './logger.js';
let currentAgent;
let currentConfig;
export function getMtlsAgent() {
    if (!currentAgent) {
        currentConfig = loadMtlsConfig();
        currentAgent = createMtlsAgent(currentConfig);
    }
    return currentAgent;
}
export function reloadMtlsAgent() {
    try {
        currentConfig = loadMtlsConfig();
        const next = createMtlsAgent(currentConfig);
        if (currentAgent) {
            currentAgent.destroy();
        }
        currentAgent = next;
        Logger.info('[mtls] HTTPS agent reloaded after certificate rotation');
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.error(`[mtls] Hot-reload failed: ${msg}`);
    }
}
export function resetMtlsAgentForTests() {
    currentAgent?.destroy();
    currentAgent = undefined;
    currentConfig = undefined;
}
//# sourceMappingURL=mtls-agent-registry.js.map