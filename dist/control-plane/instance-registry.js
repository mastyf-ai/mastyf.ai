/**
 * Registers self-hosted Mastyf AI instances with MCP Mastyf AI Cloud (heartbeat).
 */
import { getMastyfAiRegion } from '../utils/region.js';
import { Logger } from '../utils/logger.js';
let heartbeatTimer = null;
function controlPlaneUrl() {
    const url = process.env['MASTYF_AI_CONTROL_PLANE_URL']?.replace(/\/$/, '');
    return url || null;
}
function cloudApiKey() {
    return process.env['MASTYF_AI_CLOUD_API_KEY']?.trim()
        || process.env['CONTROL_PLANE_API_KEY']?.trim()
        || null;
}
export function isInstanceRegistryEnabled() {
    return Boolean(controlPlaneUrl() && cloudApiKey());
}
export async function sendInstanceHeartbeat(metrics) {
    const base = controlPlaneUrl();
    const apiKey = cloudApiKey();
    if (!base || !apiKey)
        return false;
    if (process.env.MASTYF_AI_FEDERATED_LEARNING === 'true') {
        try {
            const { syncFleetSignatureHintsFromCloud } = await import('../utils/federated-signature-exchange.js');
            await syncFleetSignatureHintsFromCloud();
        }
        catch {
            /* best-effort */
        }
    }
    const payload = {
        instanceId: process.env['MASTYF_AI_INSTANCE_ID'] || `mastyf-ai-${process.pid}`,
        instanceName: process.env['MASTYF_AI_INSTANCE_NAME'] || process.env['HOSTNAME'] || 'mastyf-ai',
        region: getMastyfAiRegion(),
        version: process.env.npm_package_version || 'unknown',
        hostname: process.env['HOSTNAME'] || 'unknown',
        metrics: metrics || {},
    };
    try {
        const res = await fetch(`${base}/api/v1/instances/heartbeat`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            Logger.debug(`[instance-registry] heartbeat failed (${res.status}): ${text.slice(0, 200)}`);
            return false;
        }
        return true;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.debug(`[instance-registry] heartbeat error: ${msg}`);
        return false;
    }
}
export function startInstanceRegistry(metricsProvider) {
    if (heartbeatTimer || !isInstanceRegistryEnabled())
        return;
    const intervalMs = parseInt(process.env['MASTYF_AI_HEARTBEAT_INTERVAL_MS'] || '60000', 10);
    const tick = () => {
        void (async () => {
            const metrics = metricsProvider ? await metricsProvider().catch(() => ({})) : {};
            await sendInstanceHeartbeat(metrics);
        })();
    };
    tick();
    heartbeatTimer = setInterval(tick, intervalMs);
    Logger.info(`[instance-registry] Cloud heartbeat started (interval=${intervalMs}ms)`);
}
export function stopInstanceRegistry() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}
//# sourceMappingURL=instance-registry.js.map