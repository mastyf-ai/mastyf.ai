/**
 * Local HTTP ingress for a single stdio MCP proxy (Fleet Hub).
 * Exposes POST /mcp (streamable) for IDE URL-based connections.
 */
import { createServer, type Server } from 'http';
import type { ProxyManager } from './proxy-manager.js';
import { Logger } from '../utils/logger.js';
import { relayMcpHttpRequest } from '../utils/mcp-http-relay.js';
import { validateHostHeader, applySafeCorsHeaders } from './http-proxy-security.js';

export interface LocalIngressOptions {
  listenPort: number;
  serverName: string;
  proxyManager: ProxyManager;
}

export class LocalIngressServer {
  private httpServer: Server | null = null;
  private boundPort = 0;

  constructor(private opts: LocalIngressOptions) {}

  getListenPort(): number {
    return this.boundPort;
  }

  async start(): Promise<number> {
    if (this.httpServer) return this.boundPort;
    this.httpServer = createServer((req, res) => {
      const hostError = validateHostHeader(req.headers.host);
      if (hostError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: hostError }));
        return;
      }

      const safeHeaders: Record<string, string | string[] | undefined> = {};
      applySafeCorsHeaders(req.headers, safeHeaders);

      const path = (req.url || '/').split('?')[0];
      if (req.method === 'POST' && path === '/mcp') {
        void relayMcpHttpRequest(req, res, this.opts.proxyManager);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Use POST /mcp for streamable HTTP MCP' }));
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(this.opts.listenPort, '127.0.0.1', () => {
        this.httpServer!.removeListener('error', reject);
        const addr = this.httpServer!.address();
        this.boundPort = typeof addr === 'object' && addr ? addr.port : this.opts.listenPort;
        Logger.info(
          `[local-ingress:${this.opts.serverName}] http://127.0.0.1:${this.boundPort}/mcp`,
        );
        resolve();
      });
    });
    return this.boundPort;
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return;
    await new Promise<void>((r) => this.httpServer!.close(() => r()));
    this.httpServer = null;
  }
}
