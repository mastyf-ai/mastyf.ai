import { ChildProcess } from 'child_process';
import { spawnUpstream } from './spawn-upstream.js';
import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import http from 'http';
import https from 'https';
import { McpServerConfig } from '../types.js';
import { Logger } from './logger.js';

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpProbeResult {
  success: boolean;
  toolCount?: number;
  toolNames?: string[];
  /** Full tool definitions from tools/list (for audit cost estimation). */
  tools?: McpToolDefinition[];
  authRequired: boolean;
  latencyMs: number;
  serverVersion?: string;
  error?: string;
}

export class McpClient {
  private static handshakeTimeoutMs(): number {
    const n = parseInt(process.env['MASTYF_AI_HEALTH_PROBE_TIMEOUT_MS'] || '15000', 10);
    return Number.isFinite(n) && n > 0 ? n : 15000;
  }

  private static sseTimeoutMs(): number {
    return McpClient.handshakeTimeoutMs();
  }

  static async probe(server: McpServerConfig): Promise<McpProbeResult> {
    if (server.transport === 'stdio' && server.command) {
      return McpClient.probeStdio(server);
    } else if (server.url) {
      return McpClient.probeSse(server);
    }
    return { success: false, authRequired: false, latencyMs: 0, error: 'No command or URL provided' };
  }

  /**
   * Full stdio JSON-RPC handshake: initialize → initialized → tools/list.
   */
  private static async probeStdio(server: McpServerConfig): Promise<McpProbeResult> {
    const start = Date.now();
    const cmd = server.command!;
    const args = server.args || [];
    const env = { ...process.env, ...(server.env || {}) };

    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawnUpstream(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err: unknown) {
        return resolve({ success: false, authRequired: false, latencyMs: Date.now() - start, error: `Spawn failed: ${err instanceof Error ? err.message : String(err)}` });
      }
      const timeout = setTimeout(() => { try { child.kill(); } catch {} resolve({ success: false, authRequired: false, latencyMs: Date.now() - start, error: 'Handshake timeout' }); }, McpClient.handshakeTimeoutMs());
      let handled = false;
      const done = (r: McpProbeResult) => { if (handled) return; handled = true; clearTimeout(timeout); try { child.kill(); } catch {} resolve(r); };
      const rl = createInterface({ input: child.stdout! });
      let authRequired = false, toolCount: number | undefined, toolNames: string[] | undefined, tools: McpToolDefinition[] | undefined, serverVersion: string | undefined;
      let initId: string, listId: string;

      initId = randomUUID();
      child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: initId, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mastyf-ai', version: '0.3.0' } } }) + '\n');

      rl.on('line', (line: string) => {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.id === initId) {
            if (msg.error) {
              authRequired = msg.error.code === -32000 || (typeof msg.error.message === 'string' && /auth/i.test(msg.error.message));
              serverVersion = undefined;
              child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
              listId = randomUUID();
              child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: listId, method: 'tools/list' }) + '\n');
            } else {
              serverVersion = msg.result?.protocolVersion || msg.result?.serverInfo?.version;
              child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
              listId = randomUUID();
              child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: listId, method: 'tools/list' }) + '\n');
            }
            return;
          }
          if (msg.id === listId && msg.result?.tools) {
            const listed = Array.isArray(msg.result.tools) ? msg.result.tools : [];
            toolCount = listed.length;
            toolNames = listed.map((t: { name?: string }) => t.name || 'unnamed');
            tools = listed.map((t: { name?: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
              name: t.name || 'unnamed',
              description: t.description,
              inputSchema: t.inputSchema,
            }));
            done({ success: true, toolCount, toolNames, tools, authRequired, latencyMs: Date.now() - start, serverVersion });
          }
        } catch {}
      });

      child.stderr?.on('data', (data: Buffer) => Logger.debug(`[${server.name} stderr] ${data.toString().trim().substring(0, 200)}`));
      child.on('error', (err) => done({ success: false, authRequired, latencyMs: Date.now() - start, error: err.message }));
      child.on('close', (code) => {
        if (!handled) done(toolCount !== undefined ? { success: true, toolCount, toolNames, tools, authRequired, latencyMs: Date.now() - start, serverVersion } : { success: false, authRequired, latencyMs: Date.now() - start, error: `Process exited with code ${code}` });
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
  private static SSE_PER_PATH_TIMEOUT_MS = 3000; // 3s per path

  private static async probeSse(server: McpServerConfig): Promise<McpProbeResult> {
    const start = Date.now();
    if (!server.url) return { success: false, authRequired: false, latencyMs: 0, error: 'No URL provided' };

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
    await McpClient.postJson(messageBase, { jsonrpc: '2.0', method: 'notifications/initialized' }, httpModule, overallTimeout).catch(() => {});

    // Step 4: POST tools/list
    const listId = randomUUID();
    const listResp = await McpClient.postJson(messageBase, { jsonrpc: '2.0', id: listId, method: 'tools/list' }, httpModule, overallTimeout);
    if (listResp?.result?.tools) {
      const listed = Array.isArray(listResp.result.tools) ? listResp.result.tools : [];
      return {
        success: true,
        toolCount: listed.length,
        toolNames: listed.map((t: { name?: string }) => t.name || 'unnamed'),
        tools: listed.map((t: { name?: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
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
  private static async discoverSessionId(
    parsedUrl: URL,
    httpModule: typeof http | typeof https,
  ): Promise<string | null> {
    const paths = ['/', '/sse', '/message'];
    for (const path of paths) {
      const probeUrl = new URL(parsedUrl.href);
      probeUrl.pathname = path;
      try {
        const id = await McpClient.getSessionId(probeUrl, httpModule, McpClient.SSE_PER_PATH_TIMEOUT_MS);
        if (id) return id;
      } catch {
        // per-path failure — try next
      }
    }
    return null;
  }

  /**
   * GET the SSE endpoint, parse the event stream for a sessionId.
   */
  private static getSessionId(parsedUrl: URL, httpModule: typeof http | typeof https, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const req = httpModule.get(parsedUrl, { timeout: timeoutMs }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk.toString());
        res.on('end', () => {
          const lines = data.split('\n');
          let currentEvent: string | null = null;
          for (const line of lines) {
            if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
            else if (line.startsWith('data: ') && currentEvent === 'endpoint') {
              const m = line.slice(6).match(/sessionId=([^&\s]+)/);
              if (m) { resolve(m[1]); return; }
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

  private static postJson(url: URL, body: any, httpModule: typeof http | typeof https, timeoutMs: number): Promise<any> {
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
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
      req.write(bodyString);
      req.end();
    });
  }
}