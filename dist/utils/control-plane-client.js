import { Logger } from './logger.js';
export class ControlPlaneClient {
    config;
    pollTimer = null;
    auditTimer = null;
    registered = false;
    constructor(config) {
        this.config = {
            pollIntervalMs: 30_000,
            auditPushIntervalMs: 60_000,
            ...config,
        };
    }
    async start() {
        await this.sendHeartbeat();
        await this.fetchLicense();
        this.startPolicyPolling();
        this.startAuditPushing();
    }
    async fetchLicense() {
        if (!this.config.onLicenseUpdate)
            return;
        const result = await this.call('license');
        if (result?.tier) {
            this.config.onLicenseUpdate(result.tier, result.features || [], result.maxInstances || 1);
        }
    }
    stop() {
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        if (this.auditTimer)
            clearInterval(this.auditTimer);
    }
    async call(action, payload) {
        try {
            const baseUrl = this.config.url.replace(/\/$/, '');
            const url = payload
                ? `${baseUrl}/api/v1/control`
                : `${baseUrl}/api/v1/control?action=${encodeURIComponent(action)}`;
            const res = await fetch(url, {
                method: payload ? 'POST' : 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`,
                },
                body: payload ? JSON.stringify({ action, ...payload }) : undefined,
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                Logger.warn(`[control-plane] ${action} failed: HTTP ${res.status} ${err.error || ''}`);
                return null;
            }
            return await res.json();
        }
        catch (err) {
            if (err.name !== 'AbortError') {
                Logger.warn(`[control-plane] ${action} unreachable: ${err.message}`);
            }
            return null;
        }
    }
    async sendHeartbeat() {
        const result = await this.call('heartbeat', {
            instanceId: this.config.instanceId,
            instanceName: this.config.instanceName || 'unnamed',
            region: this.config.region,
            version: this.config.instanceVersion || '4.1.7',
            hostname: process.env.HOSTNAME || 'localhost',
            status: 'online',
        });
        if (result?.ok) {
            this.registered = true;
            Logger.info(`[control-plane] Registered instance ${this.config.instanceId}`);
        }
    }
    startPolicyPolling() {
        let lastVersion = 0;
        this.pollTimer = setInterval(async () => {
            const result = await this.call('policy');
            if (!result || !result.policy)
                return;
            if (result.version > lastVersion && result.policy) {
                lastVersion = result.version;
                Logger.info(`[control-plane] New policy version ${result.version} received`);
                if (this.config.onPolicyUpdate) {
                    this.config.onPolicyUpdate(result.policy, result.version);
                }
            }
        }, this.config.pollIntervalMs);
    }
    startAuditPushing() {
        this.auditTimer = setInterval(async () => {
            const snapshot = this.config.onAuditSnapshot
                ? await this.config.onAuditSnapshot()
                : await this.buildAuditSnapshot();
            await this.call('audit-push', {
                instanceId: this.config.instanceId,
                periodStart: new Date(Date.now() - this.config.auditPushIntervalMs).toISOString(),
                periodEnd: new Date().toISOString(),
                aggregates: snapshot,
            });
        }, this.config.auditPushIntervalMs);
    }
    async buildAuditSnapshot() {
        return {
            totalRequests: 0,
            blockedRequests: 0,
            allowedRequests: 0,
            flaggedRequests: 0,
            topBlockedTools: [],
            topBlockedRules: [],
            avgLatencyMs: 0,
        };
    }
    async shutdown() {
        this.stop();
        await this.call('heartbeat', {
            instanceId: this.config.instanceId,
            instanceName: this.config.instanceName || 'unnamed',
            status: 'offline',
        }).catch(() => { });
    }
}
let _client = null;
export function getControlPlaneClient() {
    return _client;
}
export function createControlPlaneClient(opts) {
    const url = process.env.MASTYF_AI_CONTROL_PLANE_URL;
    const apiKey = process.env.MASTYF_AI_CLOUD_API_KEY || process.env.MASTYF_AI_LICENSE_KEY;
    if (!url || !apiKey) {
        Logger.info('[control-plane] Not configured — set MASTYF_AI_CONTROL_PLANE_URL and MASTYF_AI_CLOUD_API_KEY');
        return null;
    }
    const instanceId = process.env.MASTYF_AI_INSTANCE_ID
        || `${process.env.HOSTNAME || 'localhost'}-${process.pid}`;
    _client = new ControlPlaneClient({
        url,
        apiKey,
        instanceId,
        instanceName: process.env.MASTYF_AI_INSTANCE_NAME,
        instanceVersion: process.env.npm_package_version,
        region: process.env.MASTYF_AI_REGION || process.env.MASTYF_AI_FLEET_REGION,
        onPolicyUpdate: opts?.onPolicyUpdate,
        onAuditSnapshot: opts?.onAuditSnapshot,
        onLicenseUpdate: opts?.onLicenseUpdate,
    });
    return _client;
}
//# sourceMappingURL=control-plane-client.js.map