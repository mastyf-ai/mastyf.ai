import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import http from 'http';
import https from 'https';
import { Logger } from './logger.js';
export class McpClient {
    static handshakeTimeoutMs() {
        const n = parseInt(process.env['MASTYF_AI_HEALTH_PROBE_TIMEOUT_MS'] || '15000', 10);
        return Number.isFinite(n) && n > 0 ? n : 15000;
    }
    static sseTimeoutMs() {
        return McpClient.handshakeTimeoutMs();
    }
    static async probe(server) {
        if (server.transport === 'stdio' && server.command) {
            return McpClient.probeStdio(server);
        }
        else if (server.url) {
            return McpClient.probeSse(server);
        }
        return { success: false, authRequired: false, latencyMs: 0, error: 'No command or URL provided' };
    }
    /**
     * Full stdio JSON-RPC handshake: initialize → initialized → tools/list.
     */
    static async probeStdio(server) {
        const start = Date.now();
        const cmd = server.command;
        const args = server.args || [];
        const env = { ...process.env, ...(server.env || {}) };
        return new Promise((resolve) => {
            let child;
            try {
                child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
            }
            catch (err) {
                return resolve({ success: false, authRequired: false, latencyMs: Date.now() - start, error: `Spawn failed: ${err instanceof Error ? err.message : String(err)}` });
            }
            child.stdin?.on('error', () => { });
            child.stdout?.on('error', () => { });
            child.stderr?.on('error', () => { });
            const safeWrite = (data) => {
                try {
                    if (child.stdin && !child.stdin.destroyed && child.stdin.writable) {
                        child.stdin.write(data);
                    }
                }
                catch { }
            };
            const timeout = setTimeout(() => { try {
                child.kill();
            }
            catch { } resolve({ success: false, authRequired: false, latencyMs: Date.now() - start, error: 'Handshake timeout' }); }, McpClient.handshakeTimeoutMs());
            let handled = false;
            const done = (r) => { if (handled)
                return; handled = true; clearTimeout(timeout); try {
                child.kill();
            }
            catch { } resolve(r); };
            const rl = createInterface({ input: child.stdout });
            let authRequired = false, toolCount, toolNames, tools, serverVersion;
            let initId, listId;
            initId = randomUUID();
            safeWrite(JSON.stringify({ jsonrpc: '2.0', id: initId, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mastyf-ai', version: '0.3.0' } } }) + '\n');
            rl.on('line', (line) => {
                try {
                    const msg = JSON.parse(line.trim());
                    if (msg.id === initId) {
                        if (msg.error) {
                            authRequired = msg.error.code === -32000 || (typeof msg.error.message === 'string' && /auth/i.test(msg.error.message));
                            serverVersion = undefined;
                            safeWrite(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
                            listId = randomUUID();
                            safeWrite(JSON.stringify({ jsonrpc: '2.0', id: listId, method: 'tools/list' }) + '\n');
                        }
                        else {
                            serverVersion = msg.result?.protocolVersion || msg.result?.serverInfo?.version;
                            safeWrite(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
                            listId = randomUUID();
                            safeWrite(JSON.stringify({ jsonrpc: '2.0', id: listId, method: 'tools/list' }) + '\n');
                        }
                        return;
                    }
                    if (msg.id === listId && msg.result?.tools) {
                        const listed = Array.isArray(msg.result.tools) ? msg.result.tools : [];
                        toolCount = listed.length;
                        toolNames = listed.map((t) => t.name || 'unnamed');
                        tools = listed.map((t) => ({
                            name: t.name || 'unnamed',
                            description: t.description,
                            inputSchema: t.inputSchema,
                        }));
                        done({ success: true, toolCount, toolNames, tools, authRequired, latencyMs: Date.now() - start, serverVersion });
                    }
                }
                catch { }
            });
            child.stderr?.on('data', (data) => Logger.debug(`[${server.name} stderr] ${data.toString().trim().substring(0, 200)}`));
            child.on('error', (err) => done({ success: false, authRequired, latencyMs: Date.now() - start, error: err.message }));
            child.on('close', (code) => {
                if (!handled)
                    done(toolCount !== undefined ? { success: true, toolCount, toolNames, tools, authRequired, latencyMs: Date.now() - start, serverVersion } : { success: false, authRequired, latencyMs: Date.now() - start, error: `Process exited with code ${code}` });
            });
        });
    }
    /**
     * Full MCP-over-SSE handshake:
     * 1. GET SSE endpoint → parse sessionId from event stream
     * 2. POST initialize to /message?sessionId=...
     * 3. POST tools/list to /message?sessionId=...
     * Returns actual tool count from server — no hardcoded values.
     */
    static SSE_PER_PATH_TIMEOUT_MS = 3000; // 3s per path
    static async probeSse(server) {
        const start = Date.now();
        if (!server.url)
            return { success: false, authRequired: false, latencyMs: 0, error: 'No URL provided' };
        const baseUrl = server.url.replace(/\/$/, '');
        const parsed = new URL(baseUrl);
        const isHttps = parsed.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        const overallTimeout = McpClient.sseTimeoutMs();
        // Step 1: Multi-path SSE discovery with per-path timeout
        const sessionId = await McpClient.discoverSessionId(parsed, httpModule);
        if (!sessionId) {
            return { success: false, authRequired: false, latencyMs: Date.now() - start, error: 'Failed to obtain SSE session ID across all paths' };
        }
        // Step 2: POST initialize
        const messageBase = new URL(baseUrl);
        messageBase.pathname = messageBase.pathname.replace(/\/$/, '') + '/message';
        messageBase.searchParams.set('sessionId', sessionId);
        const initId = randomUUID();
        const initBody = { jsonrpc: '2.0', id: initId, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mastyf-ai', version: '0.3.0' } } };
        const initResp = await McpClient.postJson(messageBase, initBody, httpModule, overallTimeout);
        if (!initResp || initResp.error) {
            return { success: false, authRequired: initResp?.error?.code === -32001 || /auth/i.test(initResp?.error?.message || ''), latencyMs: Date.now() - start, error: initResp?.error?.message || 'Initialize failed' };
        }
        // Step 3: POST initialized notification
        await McpClient.postJson(messageBase, { jsonrpc: '2.0', method: 'notifications/initialized' }, httpModule, overallTimeout).catch(() => { });
        // Step 4: POST tools/list
        const listId = randomUUID();
        const listResp = await McpClient.postJson(messageBase, { jsonrpc: '2.0', id: listId, method: 'tools/list' }, httpModule, overallTimeout);
        if (listResp?.result?.tools) {
            const listed = Array.isArray(listResp.result.tools) ? listResp.result.tools : [];
            return {
                success: true,
                toolCount: listed.length,
                toolNames: listed.map((t) => t.name || 'unnamed'),
                tools: listed.map((t) => ({
                    name: t.name || 'unnamed',
                    description: t.description,
                    inputSchema: t.inputSchema,
                })),
                authRequired: false,
                latencyMs: Date.now() - start,
            };
        }
        return { success: false, authRequired: false, latencyMs: Date.now() - start, error: listResp?.error?.message || 'tools/list did not return tools' };
    }
    /**
     * Discover SSE session ID by probing multiple paths (/, /sse, /message)
     * with individual per-path timeouts so a hung TCP connection doesn't
     * exhaust the global timeout.
     */
    static async discoverSessionId(parsedUrl, httpModule) {
        const paths = ['/', '/sse', '/message'];
        for (const path of paths) {
            const probeUrl = new URL(parsedUrl.href);
            probeUrl.pathname = path;
            try {
                const id = await McpClient.getSessionId(probeUrl, httpModule, McpClient.SSE_PER_PATH_TIMEOUT_MS);
                if (id)
                    return id;
            }
            catch {
                // per-path failure — try next
            }
        }
        return null;
    }
    /**
     * GET the SSE endpoint, parse the event stream for a sessionId.
     */
    static getSessionId(parsedUrl, httpModule, timeoutMs) {
        return new Promise((resolve) => {
            const req = httpModule.get(parsedUrl, { timeout: timeoutMs }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk.toString());
                res.on('end', () => {
                    const lines = data.split('\n');
                    let currentEvent = null;
                    for (const line of lines) {
                        if (line.startsWith('event: '))
                            currentEvent = line.slice(7).trim();
                        else if (line.startsWith('data: ') && currentEvent === 'endpoint') {
                            const m = line.slice(6).match(/sessionId=([^&\s]+)/);
                            if (m) {
                                resolve(m[1]);
                                return;
                            }
                        }
                    }
                    resolve(null);
                });
            });
            req.on('timeout', () => { req.destroy(); resolve(null); });
            req.on('error', () => resolve(null));
            req.end();
        });
    }
    static postJson(url, body, httpModule, timeoutMs) {
        const bodyString = JSON.stringify(body);
        return new Promise((resolve, reject) => {
            const req = httpModule.request({
                hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search, method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(bodyString)) },
                timeout: timeoutMs,
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk.toString());
                res.on('end', () => { try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve(null);
                } });
            });
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.on('error', reject);
            req.write(bodyString);
            req.end();
        });
    }
}
//# sourceMappingURL=mcp-client.js.map