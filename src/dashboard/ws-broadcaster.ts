import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { Logger } from '../utils/logger.js';
import type { AuditTrailSync } from '../aggregator/audit-trail-sync.js';
import type { TelemetryCollector } from '../aggregator/telemetry-collector.js';
import type { LogShipper } from '../aggregator/log-shipper.js';

/**
 * WebSocket push broadcaster — replaces polling with real-time push
 * for dashboard updates. Channels: policy, AI, audit, metrics, logs.
 */
export class WsBroadcaster {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private clientSubscriptions = new Map<WebSocket, Set<string>>();
  private auditSync?: AuditTrailSync;
  private telemetryCollector?: TelemetryCollector;
  private logShipper?: LogShipper;
  private pushInterval?: ReturnType<typeof setInterval>;

  /** Live data providers (set externally before starting broadcast loop) */
  private dataProviders: {
    suggestions?: () => any[];
    baselines?: () => any[];
    aiReport?: () => any;
    aiState?: () => any;
    threats?: () => any[];
    policyRules?: () => any;
    metrics?: () => any;
    auditTrail?: () => any[];
    logs?: () => any[];
    instances?: () => any[];
  } = {};

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      this.clientSubscriptions.set(ws, new Set(['policy', 'health', 'metrics']));
      Logger.debug('[dashboard] WS client connected');

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'subscribe' && Array.isArray(msg.channels)) {
            this.clientSubscriptions.set(ws, new Set(msg.channels));
            Logger.debug(`[dashboard] WS client subscribed: ${msg.channels.join(', ')}`);
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
        Logger.debug('[dashboard] WS client disconnected');
      });

      ws.on('error', (err) => {
        Logger.warn('[dashboard] WS client error: ' + err.message);
        this.clients.delete(ws);
        this.clientSubscriptions.delete(ws);
      });

      // Send initial snapshot
      this.sendSnapshot(ws).catch(() => {});
    });
  }

  /** Set data providers for live push */
  setDataProviders(providers: typeof this.dataProviders): void {
    this.dataProviders = { ...this.dataProviders, ...providers };
  }

  /** Set aggregator services for direct queries */
  setAggregators(auditSync?: AuditTrailSync, telemetryCollector?: TelemetryCollector, logShipper?: LogShipper): void {
    this.auditSync = auditSync;
    this.telemetryCollector = telemetryCollector;
    this.logShipper = logShipper;
  }

  /**
   * Broadcast a named event to clients subscribed to the event's channel.
   * Channel is derived from the event type prefix.
   */
  broadcast(event: DashboardEvent): void {
    const payload = JSON.stringify(event);
    const channel = this.eventToChannel(event.type);

    for (const client of this.clients) {
      const subs = this.clientSubscriptions.get(client);
      if (subs && subs.has(channel) && client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch (err) {
          Logger.debug(`[dashboard] WS send failed: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }
  }

  /** Start periodic data push loop for AI, metrics, audit, and logs */
  startDataPushLoop(intervalMs: number = 5000): ReturnType<typeof setInterval> {
    if (this.pushInterval) return this.pushInterval;
    Logger.info(`[dashboard] WS data push loop started (${intervalMs}ms)`);
    this.pushInterval = setInterval(() => {
      if (this.clients.size === 0) return; // Skip if no clients connected
      this.pushLiveData().catch(err => {
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

  /** Push all live data to subscribed clients */
  private async pushLiveData(): Promise<void> {
    const batch: DashboardEvent[] = [];

    // AI Suggestions
    if (this.dataProviders.suggestions) {
      const suggestions = this.dataProviders.suggestions();
      batch.push({
        type: 'ai:suggestions',
        payload: { suggestions: suggestions || [] },
        timestamp: Date.now(),
      });
    }

    // AI Baselines
    if (this.dataProviders.baselines) {
      const baselines = this.dataProviders.baselines();
      batch.push({
        type: 'ai:baselines',
        payload: { baselines: baselines || [] },
        timestamp: Date.now(),
      });
    }

    // AI Report
    if (this.dataProviders.aiReport) {
      batch.push({
        type: 'ai:report',
        payload: { report: this.dataProviders.aiReport() },
        timestamp: Date.now(),
      });
    }

    // AI Learning State
    if (this.dataProviders.aiState) {
      batch.push({
        type: 'ai:state',
        payload: { state: this.dataProviders.aiState() },
        timestamp: Date.now(),
      });
    }

    // Threat intelligence
    if (this.dataProviders.threats) {
      const threats = this.dataProviders.threats();
      batch.push({
        type: 'ai:threats',
        payload: { threats: threats || [] },
        timestamp: Date.now(),
      });
    }

    // Aggregated metrics from TelemetryCollector
    if (this.telemetryCollector) {
      try {
        const metrics = await this.telemetryCollector.getActiveInstances();
        batch.push({
          type: 'metrics:live',
          payload: { instances: metrics },
          timestamp: Date.now(),
        });
      } catch {
        // Skip if not available
      }
    }

    // Audit trail events
    if (this.dataProviders.auditTrail) {
      const trail = this.dataProviders.auditTrail();
      batch.push({
        type: 'audit:events',
        payload: { events: trail || [] },
        timestamp: Date.now(),
      });
    }

    // Real-time logs
    if (this.dataProviders.logs) {
      const logs = this.dataProviders.logs();
      batch.push({
        type: 'logs:recent',
        payload: { logs: logs || [] },
        timestamp: Date.now(),
      });
    }

    // Instance list
    if (this.dataProviders.instances) {
      batch.push({
        type: 'instances:list',
        payload: { instances: this.dataProviders.instances() },
        timestamp: Date.now(),
      });
    }

    // Send all accumulated events
    for (const event of batch) {
      this.broadcast(event);
    }
  }

  /** Send initial snapshot to newly connected client */
  private async sendSnapshot(ws: WebSocket): Promise<void> {
    const snapshot: DashboardEvent = {
      type: 'snapshot',
      payload: {
        message: 'Connected to MCP Guardian dashboard',
        uptime: process.uptime(),
        version: process.env.npm_package_version || '2.3.24',
        timestamp: new Date().toISOString(),
      },
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(snapshot));

    // Push initial AI state if available
    if (this.dataProviders.aiState) {
      ws.send(JSON.stringify({
        type: 'ai:state',
        payload: { state: this.dataProviders.aiState() },
        timestamp: Date.now(),
      }));
    }
    if (this.dataProviders.metrics) {
      ws.send(JSON.stringify({
        type: 'metrics:live',
        payload: { metrics: this.dataProviders.metrics() },
        timestamp: Date.now(),
      }));
    }
  }

  /** Map event type to channel */
  private eventToChannel(type: DashboardEventType): string {
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
  | 'snapshot';

export interface DashboardEvent {
  type: DashboardEventType;
  serverName?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}