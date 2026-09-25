import type { IncomingMessage, ServerResponse } from 'http';
import type { ProxyManager } from '../proxy/proxy-manager.js';
export declare function relayMcpHttpRequest(req: IncomingMessage, res: ServerResponse, proxyManager: ProxyManager): Promise<void>;
//# sourceMappingURL=mcp-http-relay.d.ts.map