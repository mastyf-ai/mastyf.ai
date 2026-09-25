import type { Server } from 'http';
import type { ProxyManager } from '../proxy/proxy-manager.js';
import type { DashboardAuth } from '../auth/dashboard-auth.js';
export declare function mountMcpEndpoint(httpServer: Server, path: string, proxyManager: ProxyManager, auth?: DashboardAuth): void;
//# sourceMappingURL=mcp-http-bridge.d.ts.map