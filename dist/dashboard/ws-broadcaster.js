import { WebSocketServer, WebSocket } from 'ws';
import { Logger } from '../utils/logger.js';
import { DEFAULT_TENANT_ID, validateTenantId, InvalidTenantIdError, isMultiTenantModeEnabled, } from '../tenant/resolve-tenant.js';
import { getLicenseClient } from '../license/license-client.js';
const WS_AUTH_KEY = '__wsAuthContext';
/**
 * WebSocket push broadcaster — replaces polling with real-time push
 * for dashboard updates. Channels: policy, AI, audit, metrics, logs.
 * Clients subscribe with tenantId; pushes are scoped per connection.
 */
export class WsBroadcaster {
    wss;
    clients = new Set();
    clientSubscriptions = new Map();
    clientTenants = new Map();
    clientRoles = new Map();
    options;
    auditSync;
    telemetryCollector;
    logShipper;
    pushInterval;
    /** Live data providers (tenant-scoped where noted) */
    dataProviders = {};
    constructor(server, options = {}) {
        this.options = options;
        this.wss = new WebSocketServer({
            server,
            path: '/ws',
            verifyClient: (info, done) => {
                const auth = options.dashboardAuth;
                if (auth?.isEnabled()) {
                    const result = auth.authenticateWebSocket({
                        url: info.req.url,
                        headers: info.req.headers,
                    });
                    if (!result.authenticated) {
                        done(false, 4401, 'Authentication required');
                        return;
                    }
                    const license = getLicenseClient();
                    if (!license.hasFeature('websocket')) {
                        done(false, 4402, 'Live WebSocket unavailable for this deployment');
                        return;
                    }
                    const tenantId = result.sessionTenantId ?? license.getTenantSlug() ?? DEFAULT_TENANT_ID;
                    info.req[WS_AUTH_KEY] = {
                        authenticated: true,
                        tenantId,
                        roles: result.roles ?? ['viewer'],
                    };
                }
                done(true);
            },
        });
        this.wss.on('error', (err) => {
            Logger.warn(`[dashboard] WebSocket server error: ${err.message}`);
        });
        this.wss.on('connection', (ws, req) => {
            const authCtx = req[WS_AUTH_KEY];
            const boundTenant = authCtx?.tenantId ?? DEFAULT_TENANT_ID;
            this.clients.add(ws);
            this.clientSubscriptions.set(ws, new Set(['policy', 'health', 'metrics']));
            this.clientTenants.set(ws, boundTenant);
            this.clientRoles.set(ws, authCtx?.roles ?? ['viewer']);
            Logger.debug(`[dashboard] WS client connected tenant=${boundTenant}`);
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'subscribe' && Array.isArray(msg.channels)) {
                        const allowed = msg.channels.filter((ch) => this.isChannelAllowed(ch, authCtx?.roles ?? []));
                        this.clientSubscriptions.set(ws, new Set(allowed));
                        if (msg.tenantId?.trim() && !isMultiTenantModeEnabled()) {
                            try {
                                this.clientTenants.set(ws, validateTenantId(msg.tenantId));
                            }
                            catch (err) {
                                if (err instanceof InvalidTenantIdError) {
                                    ws.send(JSON.stringify({
                                        type: 'error',
                                        payload: { error: err.message },
                                        timestamp: Date.now(),
                                    }));
                                }
                            }
                        }
                        else if (authCtx?.tenantId) {
                            this.clientTenants.set(ws, authCtx.tenantId);
                        }
                        Logger.debug(`[dashboard] WS subscribed tenant=${this.clientTenants.get(ws)} channels=${allowed.join(', ')}`);
                    }
                    else if (msg.type === 'ping') {
                        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                    }
                }
                catch {
                    // Ignore malformed messages
                }
            });
            ws.on('close', () => {
                this.clients.delete(ws);
                this.clientSubscriptions.delete(ws);
                this.clientTenants.delete(ws);
                this.clientRoles.delete(ws);
                Logger.debug('[dashboard] WS client disconnected');
            });
            ws.on('error', (err) => {
                Logger.warn('[dashboard] WS client error: ' + err.message);
                this.clients.delete(ws);
                this.clientSubscriptions.delete(ws);
                this.clientTenants.delete(ws);
                this.clientRoles.delete(ws);
            });
            this.sendSnapshot(ws).catch(() => { });
        });
    }
    isChannelAllowed(channel, roles) {
        if (channel === 'swarm' && !roles.some((r) => ['operator', 'admin', 'tenant-admin'].includes(r))) {
            return roles.length === 0;
        }
        return true;
    }
    setDataProviders(providers) {
        this.dataProviders = { ...this.dataProviders, ...providers };
    }
    setAggregators(auditSync, telemetryCollector, logShipper) {
        this.auditSync = auditSync;
        this.telemetryCollector = telemetryCollector;
        this.logShipper = logShipper;
    }
    matchesTenant(client, eventTenantId) {
        if (!eventTenantId)
            return true;
        return this.clientTenants.get(client) === eventTenantId;
    }
    /**
     * Broadcast to clients subscribed to the channel and matching tenantId (when set).
     */
    broadcast(event, eventTenantId) {
        const tenantId = eventTenantId ?? event.tenantId;
        const payload = JSON.stringify(event);
        const channel = this.eventToChannel(event.type);
        for (const client of this.clients) {
            const subs = this.clientSubscriptions.get(client);
            if (subs
                && subs.has(channel)
                && client.readyState === WebSocket.OPEN
                && this.matchesTenant(client, tenantId)) {
                try {
                    client.send(payload);
                }
                catch (err) {
                    Logger.debug(`[dashboard] WS send failed: ${err instanceof Error ? err.message : 'unknown'}`);
                }
            }
        }
    }
    startDataPushLoop(intervalMs = 5000) {
        if (this.pushInterval)
            return this.pushInterval;
        Logger.info(`[dashboard] WS data push loop started (${intervalMs}ms)`);
        this.pushInterval = setInterval(() => {
            if (this.clients.size === 0)
                return;
            this.pushLiveData().catch((err) => {
                Logger.warn(`[dashboard] WS push error: ${err?.message}`);
            });
        }, intervalMs);
        return this.pushInterval;
    }
    stopDataPushLoop() {
        if (this.pushInterval) {
            clearInterval(this.pushInterval);
            this.pushInterval = undefined;
            Logger.info('[dashboard] WS data push loop stopped');
        }
    }
    async pushLiveDataForClient(client) {
        const tenantId = this.clientTenants.get(client) || DEFAULT_TENANT_ID;
        const batch = [];
        if (this.dataProviders.suggestions) {
            const suggestions = this.dataProviders.suggestions(tenantId);
            batch.push({
                type: 'ai:suggestions',
                tenantId,
                payload: { suggestions: suggestions || [] },
                timestamp: Date.now(),
            });
        }
        if (this.dataProviders.baselines) {
            const baselines = this.dataProviders.baselines(tenantId);
            batch.push({
                type: 'ai:baselines',
                tenantId,
                payload: { baselines: baselines || [] },
                timestamp: Date.now(),
            });
        }
        if (this.dataProviders.aiReport) {
            batch.push({
                type: 'ai:report',
                tenantId,
                payload: { report: this.dataProviders.aiReport(tenantId) },
                timestamp: Date.now(),
            });
        }
        if (this.dataProviders.aiState) {
            batch.push({
                type: 'ai:state',
                tenantId,
                payload: { state: this.dataProviders.aiState(tenantId) },
                timestamp: Date.now(),
            });
        }
        if (this.dataProviders.threats) {
            const threats = this.dataProviders.threats(tenantId);
            batch.push({
                type: 'ai:threats',
                tenantId,
                payload: { threats: threats || [] },
                timestamp: Date.now(),
            });
        }
        if (this.dataProviders.metrics) {
            try {
                const metrics = await Promise.resolve(this.dataProviders.metrics(tenantId));
                batch.push({
                    type: 'metrics:live',
                    tenantId,
                    payload: { metrics },
                    timestamp: Date.now(),
                });
            }
            catch {
                /* skip */
            }
        }
        else if (this.telemetryCollector) {
            try {
                const instances = await this.telemetryCollector.getActiveInstances();
                batch.push({
                    type: 'metrics:live',
                    tenantId,
                    payload: { instances },
                    timestamp: Date.now(),
                });
            }
            catch {
                /* skip */
            }
        }
        if (this.dataProviders.auditTrail) {
            try {
                const trail = await Promise.resolve(this.dataProviders.auditTrail(tenantId));
                batch.push({
                    type: 'audit:events',
                    tenantId,
                    payload: { events: trail || [] },
                    timestamp: Date.now(),
                });
            }
            catch {
                /* skip */
            }
        }
        if (this.dataProviders.logs) {
            const logs = this.dataProviders.logs(tenantId);
            batch.push({
                type: 'logs:recent',
                tenantId,
                payload: { logs: logs || [] },
                timestamp: Date.now(),
            });
        }
        if (this.dataProviders.instances) {
            batch.push({
                type: 'instances:list',
                tenantId,
                payload: { instances: this.dataProviders.instances(tenantId) },
                timestamp: Date.now(),
            });
        }
        return batch;
    }
    async pushLiveData() {
        for (const client of this.clients) {
            const batch = await this.pushLiveDataForClient(client);
            for (const event of batch) {
                const channel = this.eventToChannel(event.type);
                const subs = this.clientSubscriptions.get(client);
                if (subs?.has(channel) && client.readyState === WebSocket.OPEN) {
                    try {
                        client.send(JSON.stringify(event));
                    }
                    catch {
                        /* ignore */
                    }
                }
            }
        }
    }
    async sendSnapshot(ws) {
        const tenantId = this.clientTenants.get(ws) || DEFAULT_TENANT_ID;
        const snapshot = {
            type: 'snapshot',
            tenantId,
            payload: {
                message: 'Connected to MCP Mastyf AI dashboard',
                uptime: process.uptime(),
                version: process.env.npm_package_version || '2.3.24',
                timestamp: new Date().toISOString(),
                tenantId,
            },
            timestamp: Date.now(),
        };
        ws.send(JSON.stringify(snapshot));
        if (this.dataProviders.aiState) {
            ws.send(JSON.stringify({
                type: 'ai:state',
                tenantId,
                payload: { state: this.dataProviders.aiState(tenantId) },
                timestamp: Date.now(),
            }));
        }
        if (this.dataProviders.metrics) {
            Promise.resolve(this.dataProviders.metrics(tenantId))
                .then((metrics) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'metrics:live',
                        tenantId,
                        payload: { metrics },
                        timestamp: Date.now(),
                    }));
                }
            })
                .catch(() => { });
        }
    }
    eventToChannel(type) {
        if (type.startsWith('flow:'))
            return 'flow';
        if (type.startsWith('swarm:'))
            return 'swarm';
        if (type.startsWith('semantic:'))
            return 'flow';
        if (type.startsWith('analysis:'))
            return 'swarm';
        if (type.startsWith('threat-discovery:'))
            return 'swarm';
        if (type.startsWith('tribunal:'))
            return 'flow';
        if (type.startsWith('ai:'))
            return 'ai';
        if (type.startsWith('audit:'))
            return 'audit';
        if (type.startsWith('metrics:'))
            return 'metrics';
        if (type.startsWith('logs:'))
            return 'logs';
        if (type.startsWith('instances:'))
            return 'instances';
        if (type === 'policy-block' || type === 'policy-reload')
            return 'policy';
        if (type === 'health-change' || type === 'circuit-breaker-open')
            return 'health';
        if (type === 'cost-threshold')
            return 'cost';
        return 'policy';
    }
    getClientCount() {
        return this.clients.size;
    }
    /** Test helper: tenant bound to a client socket */
    getClientTenant(ws) {
        return this.clientTenants.get(ws);
    }
}
//# sourceMappingURL=ws-broadcaster.js.map