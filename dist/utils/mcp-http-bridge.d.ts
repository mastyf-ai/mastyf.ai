import type { Server } from 'http';
import type { ProxyManager } from '../proxy/proxy-manager.js';
import type { DashboardAuth } from '../auth/dashboard-auth.js';
/**
 * Serve POST <path> on the dashboard's HTTP server by relaying it to the MCP proxy.
 * Every request passes the dashboard's own authentication first; without an auth checker the
 * endpoint is not mounted at all. Cross-site browser requests are always refused, and when
 * dashboard auth is turned off (loopback-only), the Host must be loopback too.
 */
export declare function mountMcpEndpoint(httpServer: Server, path: string, proxyManager: ProxyManager, auth: DashboardAuth): void;
//# sourceMappingURL=mcp-http-bridge.d.ts.map