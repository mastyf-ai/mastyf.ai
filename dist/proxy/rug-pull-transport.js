/**
 * Shared rug-pull checks for HTTP/SSE/streamable transports.
 */
import { applyToolFingerprintFromResult, } from './tool-fingerprint.js';
import { isClusterRugPullActive, publishRugPullAlert } from './rug-pull-cluster.js';
import { onToolsListObserved } from './lifecycle-assurance-gates.js';
export async function isRugPullBlockedForCall(state, serverName, tenantId) {
    if (state.blocked)
        return true;
    return isClusterRugPullActive(serverName, tenantId);
}
export function fingerprintJsonRpcToolsList(state, payload, serverName, tenantId, logPrefix) {
    if (!payload || typeof payload !== 'object')
        return;
    const msg = payload;
    if (!msg.result)
        return;
    const tools = msg.result.tools;
    if (Array.isArray(tools) && tools.length > 0) {
        onToolsListObserved(serverName, tools.filter((t) => typeof t.name === 'string'));
    }
    applyToolFingerprintFromResult(state, msg.result, {
        serverName,
        tenantId,
        logPrefix,
        onMismatch: async () => {
            void publishRugPullAlert(serverName, tenantId, state.fingerprint || '');
        },
    });
}
//# sourceMappingURL=rug-pull-transport.js.map