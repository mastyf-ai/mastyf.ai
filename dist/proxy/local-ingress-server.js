/**
 * Local HTTP ingress for a single stdio MCP proxy (Fleet Hub).
 * Exposes POST /mcp (streamable) for IDE URL-based connections.
 */
import { createServer } from 'http';
import { Logger } from '../utils/logger.js';
import { relayMcpHttpRequest } from '../utils/mcp-http-relay.js';
import { validateHostHeader, applySafeCorsHeaders } from './http-proxy-security.js';
export class LocalIngressServer {
    opts;
    httpServer = null;
    boundPort = 0;
    constructor(opts) {
        this.opts = opts;
    }
    getListenPort() {
        return this.boundPort;
    }
    async start() {
        if (this.httpServer)
            return this.boundPort;
        this.httpServer = createServer((req, res) => {
            const hostError = validateHostHeader(req.headers.host);
            if (hostError) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: hostError }));
                return;
            }
            const safeHeaders = {};
            applySafeCorsHeaders(req.headers, safeHeaders);
            const path = (req.url || '/').split('?')[0];
            if (req.method === 'POST' && path === '/mcp') {
                void relayMcpHttpRequest(req, res, this.opts.proxyManager);
                return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Use POST /mcp for streamable HTTP MCP' }));
        });
        await new Promise((resolve, reject) => {
            this.httpServer.once('error', reject);
            this.httpServer.listen(this.opts.listenPort, '127.0.0.1', () => {
                this.httpServer.removeListener('error', reject);
                const addr = this.httpServer.address();
                this.boundPort = typeof addr === 'object' && addr ? addr.port : this.opts.listenPort;
                Logger.info(`[local-ingress:${this.opts.serverName}] http://127.0.0.1:${this.boundPort}/mcp`);
                resolve();
            });
        });
        return this.boundPort;
    }
    async stop() {
        if (!this.httpServer)
            return;
        await new Promise((r) => this.httpServer.close(() => r()));
        this.httpServer = null;
    }
}
//# sourceMappingURL=local-ingress-server.js.map