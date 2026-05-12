import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { Logger } from '../utils/logger.js';

/**
 * GAP 13: WebSocket push broadcaster — replaces 5s polling
 * with real-time push for dashboard updates.
 */
export class WsBroadcaster {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      Logger.debug('[dashboard] WS client connected');

      ws.on('close', () => {
        this.clients.delete(ws);
        Logger.debug('[dashboard] WS client disconnected');
      });

      ws.on('error', (err) => {
        Logger.warn('[dashboard] WS client error: ' + err.message);
        this.clients.delete(ws);
      });

      void this.sendSnapshot(ws);
    });
  }

  broadcast(event: DashboardEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private async sendSnapshot(ws: WebSocket): Promise<void> {
    ws.send(JSON.stringify({ type: 'snapshot', data: {} }));
  }
}

export type DashboardEventType =
  | 'policy-block'
  | 'health-change'
  | 'cost-threshold'
  | 'circuit-breaker-open'
  | 'policy-reload';

export interface DashboardEvent {
  type: DashboardEventType;
  serverName?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}