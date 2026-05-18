/**
 * WebSocket MCP transport proxy (MCP 0.5+) — foundational support.
 *
 * Accepts WS upgrade, forwards JSON-RPC frames upstream, runs policy on tools/call.
 * Limitations: single upstream URL, no SSE multiplexing, no session resumption.
 */
import { createServer, type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { PolicyEngine } from '../policy/policy-engine.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { resolveTenantId } from '../tenant/resolve-tenant.js';
import type { CallContext } from '../policy/policy-types.js';

export interface WebSocketProxyOptions {
  listenPort: number;
  upstreamWsUrl: string;
  serverName: string;
  policy?: PolicyEngine;
}

export class WebSocketProxyServer {
  private opts: WebSocketProxyOptions;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;

  constructor(opts: WebSocketProxyOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (clientWs, req) => {
      void this.handleClientConnection(clientWs, req);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(this.opts.listenPort, () => {
        this.httpServer!.removeListener('error', reject);
        Logger.info(
          `[ws-proxy:${this.opts.serverName}] Listening on ws://0.0.0.0:${this.opts.listenPort} → ${this.opts.upstreamWsUrl}`,
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      this.httpServer?.close(() => resolve());
    });
  }

  private async handleClientConnection(clientWs: WebSocket, req: IncomingMessage): Promise<void> {
    const upstream = new WebSocket(this.opts.upstreamWsUrl);

    upstream.on('open', () => {
      clientWs.on('message', (data) => {
        void this.interceptMessage(data, clientWs, upstream);
      });
      upstream.on('message', (data) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
      });
    });

    upstream.on('error', (err) => {
      Logger.warn(`[ws-proxy:${this.opts.serverName}] upstream error: ${err.message}`);
      clientWs.close(1011, 'upstream error');
    });

    clientWs.on('close', () => upstream.close());
    upstream.on('close', () => clientWs.close());

    clientWs.on('error', () => upstream.close());
  }

  private async interceptMessage(
    data: WebSocket.RawData,
    clientWs: WebSocket,
    upstream: WebSocket,
  ): Promise<void> {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      upstream.send(raw);
      return;
    }

    if (msg.method === 'tools/call' && this.opts.policy) {
      const tenantId = resolveTenantId({
        header: undefined,
        meta: (msg.params as Record<string, unknown> | undefined)?._meta,
      });
      const context: CallContext = {
        serverName: this.opts.serverName,
        toolName: (msg.params as { name?: string })?.name || 'unknown',
        arguments: (msg.params as { arguments?: Record<string, unknown> })?.arguments,
        requestId: String(msg.id ?? randomUUID()),
        requestTokens: raw.length,
        timestamp: new Date().toISOString(),
        tenantId,
      };
      const decision = await this.opts.policy.evaluateAsync(context);
      if (decision.action === 'block') {
        StructuredLogger.logBlocked({
          event: 'tool_blocked',
          requestId: context.requestId,
          serverName: this.opts.serverName,
          toolName: context.toolName,
          reason: decision.reason,
          rule: decision.rule,
        });
        clientWs.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: {
            code: -32001,
            message: `Blocked by MCP Guardian policy: ${decision.reason}`,
          },
        }));
        return;
      }
    }

    if (upstream.readyState === WebSocket.OPEN) upstream.send(raw);
  }
}
