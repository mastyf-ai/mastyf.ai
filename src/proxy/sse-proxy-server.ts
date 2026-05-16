import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import { PolicyEngine } from '../policy/policy-engine.js';
import { HistoryDatabase } from '../database/history-db.js';
import { TokenCounter } from '../utils/token-counter.js';
import { Logger } from '../utils/logger.js';

interface SseProxyOptions {
  upstreamUrl: string;
  serverName: string;
  policy?: PolicyEngine;
  db: HistoryDatabase;
  authHeader?: string;
}

/**
 * SSEProxyServer wraps an HTTP/SSE MCP server.
 * - Forwards all JSON-RPC messages upstream
 * - Intercepts tools/call for policy enforcement + token counting
 * - Emits 'blocked' events for audit logging
 */
export class SseProxyServer extends EventEmitter {
  private opts: SseProxyOptions;
  private tokenCounter: TokenCounter;

  constructor(opts: SseProxyOptions) {
    super();
    this.opts = opts;
    this.tokenCounter = new TokenCounter();
  }

  async interceptAndForward(
    jsonRpcRequest: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const isToolCall = jsonRpcRequest.method === 'tools/call';

    // Policy check
    if (isToolCall && this.opts.policy) {
      const context = {
        serverName: this.opts.serverName,
        toolName: (jsonRpcRequest.params as any)?.name || 'unknown',
        arguments: (jsonRpcRequest.params as any)?.arguments,
        requestId: String(jsonRpcRequest.id ?? 'sse-request'),
        requestTokens: this.tokenCounter.count(JSON.stringify(jsonRpcRequest)),
        timestamp: new Date().toISOString(),
      };
      const decision = this.opts.policy.evaluate(context);
      if (decision.action === 'block') {
        this.emit('blocked', { serverName: this.opts.serverName, reason: decision.reason });
        return {
          jsonrpc: '2.0',
          id: jsonRpcRequest.id,
          error: {
            code: -32001,
            message: `Blocked by MCP Guardian policy: ${decision.reason}`,
          },
        };
      }
    }

    const startMs = Date.now();
    const response = await this._forwardToUpstream(jsonRpcRequest);
    const durationMs = Date.now() - startMs;

    // Token counting for tools/call
    if (isToolCall) {
      const inputTokens = this.tokenCounter.count(JSON.stringify(jsonRpcRequest));
      const outputTokens = this.tokenCounter.count(JSON.stringify(response));
      const params = jsonRpcRequest.params as Record<string, unknown> | undefined;
      const record = {
        serverName: this.opts.serverName,
        toolName: (params?.name as string) ?? 'unknown',
        requestTokens: inputTokens,
        responseTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
        durationMs,
        timestamp: new Date().toISOString(),
      };
      try {
        // Fire-and-forget best-effort; errors are logged but non-critical
        this.opts.db.addCallRecord(record).catch(err => {
          Logger.warn(`[sse-proxy:${this.opts.serverName}] Failed to record call: ${err?.message}`);
        });
      } catch { /* best-effort — only catches synchronous errors in record construction */ }
    }

    return response;
  }

  private _forwardToUpstream(
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.opts.upstreamUrl);
      const client = url.protocol === 'https:' ? https : http;
      const payload = JSON.stringify(body);

      const req = client.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            ...(this.opts.authHeader
              ? { Authorization: this.opts.authHeader }
              : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error(`Upstream returned non-JSON: ${data.slice(0, 200)}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.setTimeout(30_000, () => {
        req.destroy();
        reject(new Error('Upstream request timed out after 30s'));
      });
      req.write(payload);
      req.end();
    });
  }
}