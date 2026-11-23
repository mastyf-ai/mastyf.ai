import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { Logger } from '../utils/logger.js';
import {
  DEFAULT_TENANT_ID,
  validateTenantId,
  InvalidTenantIdError,
  isMultiTenantModeEnabled,
} from '../tenant/resolve-tenant.js';
import type { AuditTrailSync } from '../aggregator/audit-trail-sync.js';
import type { TelemetryCollector } from '../aggregator/telemetry-collector.js';
import type { LogShipper } from '../aggregator/log-shipper.js';
import type { DashboardAuth } from '../auth/dashboard-auth.js';
import type { DashboardRole } from '../auth/dashboard-rbac.js';
import { getLicenseClient } from '../license/license-client.js';

export type WsAuthContext = {
  authenticated: boolean;
  tenantId: string;
  roles: DashboardRole[];
};

export type WsBroadcasterOptions = {
  dashboardAuth?: DashboardAuth;
  /** Ignored unless MASTYF_AI_REQUIRE_LICENSE=true (license paywall removed by default). */
  requireLicense?: boolean;
};

const WS_AUTH_KEY = '__wsAuthContext';

/**
 * WebSocket push broadcaster — replaces polling with real-time push
 * for dashboard updates. Channels: policy, AI, audit, metrics, logs.
 * Clients subscribe with tenantId; pushes are scoped per connection.
 */
export class WsBroadcaster {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private clientSubscriptions = new Map<WebSocket, Set<string>>();
  private clientTenants = new Map<WebSocket, string>();
  private clientRoles = new Map<WebSocket, DashboardRole[]>();
  private options: WsBroadcasterOptions;
  private auditSync?: AuditTrailSync;
  private telemetryCollector?: TelemetryCollector;
  private logShipper?: LogShipper;
  private pushInterval?: ReturnType<typeof setInterval>;

  /** Live data providers (tenant-scoped where noted) */
  private dataProviders: {
    suggestions?: (tenantId: string) => unknown[];
    baselines?: (tenantId: string) => unknown[];
    aiReport?: (tenantId: string) => unknown;
    aiState?: (tenantId: string) => unknown;
    threats?: (tenantId: string) => unknown[];
    policyRules?: () => unknown;
    metrics?: (tenantId: string) => Promise<unknown> | unknown;
    auditTrail?: (tenantId: string) => Promise<unknown[]> | unknown[];
    logs?: (tenantId: string) => string[];
    instances?: (tenantId: string) => unknown[];
  } = {};

  constructor(server: Server, options: WsBroadcasterOptions = {}) {
    this.options = options;

    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      verifyClient: (info, done) => {
        const auth = options.dashboardAuth;
        if (!auth?.isEnabled()) {
          done(true);
          return;
        }
        void auth
          .authenticateWebSocketAsync({
            url: info.req.url,
            headers: info.req.headers as Record<string, string | string[] | undefined>,
          })
          .then((result) => {
            if (!result.authenticated) {
              done(false, 4401, 'Authentication required');
              return;
            }
            const license = getLicenseClient();
            if (!license.hasFeature('websocket')) {
              done(false, 4402, 'Live WebSocket unavailable for this deployment');
              return;
            }
            const tenantId =
              result.sessionTenantId ?? license.getTenantSlug() ?? DEFAULT_TENANT_ID;
            (info.req as IncomingMessage & Record<string, unknown>)[WS_AUTH_KEY] = {
              authenticated: true,
              tenantId,
              roles: result.roles ?? ['viewer'],
            } satisfies WsAuthContext;
            done(true);
          })
          .catch(() => done(false, 4401, 'Authentication required'));
      },
    });
    this.wss.on('error', (err) => {
      Logger.warn(`[dashboard] WebSocket server error: ${err.message}`);
    });

    this.wss.on('connection', (ws, req) => {
      const authCtx = (req as IncomingMessage & Record<string, unknown>)[WS_AUTH_KEY] as
        | WsAuthContext
        | undefined;
      const boundTenant = authCtx?.tenantId ?? DEFAULT_TENANT_ID;

      this.clients.add(ws);
      this.clientSubscriptions.set(ws, new Set(['policy', 'health', 'metrics']));
      this.clientTenants.set(ws, boundTenant);
      this.clientRoles.set(ws, authCtx?.roles ?? ['viewer']);
      Logger.debug(`[dashboard] WS client connected tenant=${boundTenant}`);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            type?: string;
            channels?: string[];
            tenantId?: string;
          };
          if (msg.type === 'subscribe' && Array.isArray(msg.channels)) {
            const allowed = msg.channels.filter((ch) =>
              this.isChannelAllowed(ch, authCtx?.roles ?? []),
            );
            this.clientSubscriptions.set(ws, new Set(allowed));

            if (msg.tenantId?.trim() && !isMultiTenantModeEnabled()) {
              try {
                this.clientTenants.set(ws, validateTenantId(msg.tenantId));
              } catch (err) {
                if (err instanceof InvalidTenantIdError) {
                  ws.send(JSON.stringify({
                    type: 'error',
                    payload: { error: err.message },
                    timestamp: Date.now(),
                  }));
                }
              }
            } else if (authCtx?.tenantId) {
              this.clientTenants.set(ws, authCtx.tenantId);
            }
            Logger.debug(
              `[dashboard] WS subscribed tenant=${this.clientTenants.get(ws)} channels=${allowed.join(', ')}`,
            );
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch {
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

      this.sendSnapshot(ws).catch(() => {});
    });
  }

  private isChannelAllowed(channel: string, roles: DashboardRole[]): boolean {
    if (channel === 'swarm' && !roles.some((r) => ['operator', 'admin', 'tenant-admin'].includes(r))) {
      return roles.length === 0;
    }
    return true;
  }

  setDataProviders(providers: typeof this.dataProviders): void {
    this.dataProviders = { ...this.dataProviders, ...providers };
  }

  setAggregators(auditSync?: AuditTrailSync, telemetryCollector?: TelemetryCollector, logShipper?: LogShipper): void {
    this.auditSync = auditSync;
    this.telemetryCollector = telemetryCollector;
    this.logShipper = logShipper;
  }

  private matchesTenant(client: WebSocket, eventTenantId?: string): boolean {
    if (!eventTenantId) return true;
    return this.clientTenants.get(client) === eventTenantId;
  }

  /**
   * Broadcast to clients subscribed to the channel and matching tenantId (when set).
   */
  broadcast(event: DashboardEvent, eventTenantId?: string): void {
    const tenantId = eventTenantId ?? event.tenantId;
    const payload = JSON.stringify(event);
    const channel = this.eventToChannel(event.type);

    for (const client of this.clients) {
      const subs = this.clientSubscriptions.get(client);
      if (
        subs
        && subs.has(channel)
        && client.readyState === WebSocket.OPEN
        && this.matchesTenant(client, tenantId)
      ) {
        try {
          client.send(payload);
        } catch (err) {
          Logger.debug(`[dashboard] WS send failed: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }
  }

  startDataPushLoop(intervalMs: number = 5000): ReturnType<typeof setInterval> {
    if (this.pushInterval) return this.pushInterval;
    Logger.info(`[dashboard] WS data push loop started (${intervalMs}ms)`);
    this.pushInterval = setInterval(() => {
      if (this.clients.size === 0) return;
      this.pushLiveData().catch((err) => {
        Logger.warn(`[dashboard] WS push error: ${err?.message}`);
      });
    }, intervalMs);
    return this.pushInterval;
  }

  stopDataPushLoop(): void {
    if (this.pushInterval) {
      clearInterval(this.pushInterval);
      this.pushInterval = undefined;
      Logger.info('[dashboard] WS data push loop stopped');
    }
  }

  private async pushLiveDataForClient(client: WebSocket): Promise<DashboardEvent[]> {
    const tenantId = this.clientTenants.get(client) || DEFAULT_TENANT_ID;
    const batch: DashboardEvent[] = [];

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
      } catch {
        /* skip */
      }
    } else if (this.telemetryCollector) {
      try {
        const instances = await this.telemetryCollector.getActiveInstances();
        batch.push({
          type: 'metrics:live',
          tenantId,
          payload: { instances },
          timestamp: Date.now(),
        });
      } catch {
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
      } catch {
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

  private async pushLiveData(): Promise<void> {
    for (const client of this.clients) {
      const batch = await this.pushLiveDataForClient(client);
      for (const event of batch) {
        const channel = this.eventToChannel(event.type);
        const subs = this.clientSubscriptions.get(client);
        if (subs?.has(channel) && client.readyState === WebSocket.OPEN) {
          try {
            client.send(JSON.stringify(event));
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  private async sendSnapshot(ws: WebSocket): Promise<void> {
    const tenantId = this.clientTenants.get(ws) || DEFAULT_TENANT_ID;
    const snapshot: DashboardEvent = {
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
        .catch(() => {});
    }
  }

  eventToChannel(type: DashboardEventType): string {
    if (type.startsWith('flow:')) return 'flow';
    if (type.startsWith('swarm:')) return 'swarm';
    if (type.startsWith('semantic:')) return 'flow';
    if (type.startsWith('analysis:')) return 'swarm';
    if (type.startsWith('threat-discovery:')) return 'swarm';
    if (type.startsWith('tribunal:')) return 'flow';
    if (type.startsWith('ai:')) return 'ai';
    if (type.startsWith('audit:')) return 'audit';
    if (type.startsWith('metrics:')) return 'metrics';
    if (type.startsWith('logs:')) return 'logs';
    if (type.startsWith('instances:')) return 'instances';
    if (type === 'policy-block' || type === 'policy-reload') return 'policy';
    if (type === 'health-change' || type === 'circuit-breaker-open') return 'health';
    if (type === 'cost-threshold') return 'cost';
    return 'policy';
  }

  getClientCount(): number {
    return this.clients.size;
  }

  /** Test helper: tenant bound to a client socket */
  getClientTenant(ws: WebSocket): string | undefined {
    return this.clientTenants.get(ws);
  }
}

export type DashboardEventType =
  | 'policy-block'
  | 'health-change'
  | 'cost-threshold'
  | 'circuit-breaker-open'
  | 'policy-reload'
  | 'ai:suggestions'
  | 'ai:baselines'
  | 'ai:report'
  | 'ai:state'
  | 'ai:threats'
  | 'audit:events'
  | 'audit:decision'
  | 'metrics:live'
  | 'metrics:history'
  | 'logs:recent'
  | 'logs:alert'
  | 'instances:list'
  | 'instances:status'
  | 'flow:step'
  | 'swarm:progress'
  | 'swarm:done'
  | 'swarm:failed'
  | 'semantic:queued'
  | 'semantic:complete'
  | 'analysis:artifact'
  | 'threat-discovery:started'
  | 'threat-discovery:done'
  | 'threat-discovery:failed'
  | 'tribunal:started'
  | 'tribunal:done'
  | 'tribunal:failed'
  | 'snapshot';

export interface DashboardEvent {
  type: DashboardEventType;
  serverName?: string;
  tenantId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}
