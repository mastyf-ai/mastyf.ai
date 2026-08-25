import type { Server, IncomingMessage, ServerResponse } from 'http';
import type { ProxyManager } from '../proxy/proxy-manager.js';
import type { DashboardAuth } from '../auth/dashboard-auth.js';
import { Logger } from './logger.js';
import { relayMcpHttpRequest } from './mcp-http-relay.js';

export function mountMcpEndpoint(
  httpServer: Server,
  path: string,
  proxyManager: ProxyManager,
  auth?: DashboardAuth,
): void {
  if (!httpServer || !proxyManager) return;

  const originalListeners = httpServer.listeners('request').slice();
  httpServer.removeAllListeners('request');

  httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url || '/').split('?')[0] || '/';

    if (req.method === 'POST' && url === path) {
      if (auth) {
        const result = auth.authenticate({
          url: req.url,
          headers: req.headers as Record<string, string | string[] | undefined>,
          method: req.method,
        });
        if (!result.authenticated) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Authentication required', reason: result.reason }));
          return;
        }
      }
      void relayMcpHttpRequest(req, res, proxyManager);
      return;
    }

    for (const listener of originalListeners) {
      listener(req, res);
    }
  });

  Logger.info(`[mcp-bridge] MCP endpoint mounted at POST ${path}`);
}
