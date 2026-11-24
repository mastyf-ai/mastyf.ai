import type { Server, IncomingMessage, ServerResponse } from 'http';
import type { ProxyManager } from '../proxy/proxy-manager.js';
import type { DashboardAuth } from '../auth/dashboard-auth.js';
import { Logger } from './logger.js';
import { relayMcpHttpRequest } from './mcp-http-relay.js';
import { localOnlyRequestError } from './local-request-guard.js';

/**
 * Serve POST <path> on the dashboard's HTTP server by relaying it to the MCP proxy.
 * Every request passes the dashboard's own authentication first; without an auth checker the
 * endpoint is not mounted at all. Cross-site browser requests are always refused, and when
 * dashboard auth is turned off (loopback-only), the Host must be loopback too.
 */
export function mountMcpEndpoint(
  httpServer: Server,
  path: string,
  proxyManager: ProxyManager,
  auth: DashboardAuth,
): void {
  if (!httpServer || !proxyManager) return;
  if (!auth) {
    Logger.error(`[mcp-bridge] Not mounting POST ${path}: no dashboard authentication was provided`);
    return;
  }

  const originalListeners = httpServer.listeners('request').slice();
  httpServer.removeAllListeners('request');

  httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url || '/').split('?')[0] || '/';

    if (req.method === 'POST' && url === path) {
      const localError = localOnlyRequestError(req, { requireLoopbackHost: !auth.requiresAuthentication() });
      if (localError) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: localError }));
        return;
      }
      const result = auth.authenticate({
        url: req.url,
        headers: req.headers as Record<string, string | string[] | undefined>,
        method: req.method,
        remoteAddress: req.socket?.remoteAddress,
      });
      if (!result.authenticated) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required', reason: result.reason }));
        return;
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
