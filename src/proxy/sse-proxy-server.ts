import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import { PolicyEngine } from '../policy/policy-engine.js';
import { detectPromptInjection } from '../scanners/prompt-injection-detector.js';
import { TokenCounter, extractModelFromPayload } from '../utils/token-counter.js';
import { Logger } from '../utils/logger.js';
import { persistCallRecord } from '../utils/call-record-cost.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import * as Metrics from '../utils/metrics.js';
import { resolveModelId, resolveModelIdForServer } from '../config/llm-config.js';
import { MtlsConfig, createMtlsAgent, loadMtlsConfig } from '../utils/mtls-config.js';
import type { Agent as HttpsAgent } from 'https';
import { resolveTenantId } from '../tenant/resolve-tenant.js';

interface SseProxyOptions {
  upstreamUrl: string;
  serverName: string;
  policy?: PolicyEngine;
  db: import('../database/database-interface.js').IDatabase;
  authHeader?: string;
  mtlsConfig?: MtlsConfig;
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
  private httpsAgent: HttpsAgent | undefined;

  constructor(opts: SseProxyOptions) {
    super();
    this.opts = opts;
    this.tokenCounter = new TokenCounter();
    const mtls = opts.mtlsConfig ?? loadMtlsConfig();
    this.httpsAgent = createMtlsAgent(mtls);
    if (this.httpsAgent) {
      Logger.info(`[sse-proxy:${opts.serverName}] mTLS enabled for upstream connection`);
    }
  }

  async interceptAndForward(
    jsonRpcRequest: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const isToolCall = jsonRpcRequest.method === 'tools/call';

    // Policy check
    if (isToolCall && this.opts.policy) {
      const tenantId = resolveTenantId({
        meta: (jsonRpcRequest.params as Record<string, unknown> | undefined)?._meta,
      });
      const context = {
        serverName: this.opts.serverName,
        toolName: (jsonRpcRequest.params as { name?: string })?.name || 'unknown',
        arguments: (jsonRpcRequest.params as { arguments?: Record<string, unknown> })?.arguments,
        requestId: String(jsonRpcRequest.id ?? 'sse-request'),
        requestTokens: this.tokenCounter.count(JSON.stringify(jsonRpcRequest)),
        timestamp: new Date().toISOString(),
        tenantId,
      };
      const decision = await this.opts.policy.evaluateAsync(context);
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
    let response = await this._forwardToUpstream(jsonRpcRequest);
    const durationMs = Date.now() - startMs;

    if (isToolCall) {
      const toolName = (jsonRpcRequest.params as { name?: string } | undefined)?.name ?? 'unknown';
      const blockedResponse = this.inspectToolResponse(toolName, response, jsonRpcRequest.id);
      if (blockedResponse) {
        return blockedResponse;
      }
    }

    // Token counting for tools/call
    if (isToolCall) {
      const params = jsonRpcRequest.params as Record<string, unknown> | undefined;
      const model =
        resolveModelId(extractModelFromPayload(jsonRpcRequest)) ||
        resolveModelIdForServer(this.opts.serverName);
      const requestText = JSON.stringify(jsonRpcRequest);
      const responseText = JSON.stringify(response);
      const counts = this.tokenCounter.countProxyCall({
        requestText,
        responseText,
        model,
        requestPayload: jsonRpcRequest,
        responsePayload: response,
      });
      const record = {
        serverName: this.opts.serverName,
        toolName: (params?.name as string) ?? 'unknown',
        requestTokens: counts.requestTokens,
        responseTokens: counts.responseTokens,
        totalTokens: counts.totalTokens,
        durationMs,
        timestamp: new Date().toISOString(),
        tokenSource: counts.tokenSource,
        model,
      };
      try {
        persistCallRecord(this.opts.db, record, jsonRpcRequest).catch((err: Error) => {
          Logger.warn(`[sse-proxy:${this.opts.serverName}] Failed to record call: ${err?.message}`);
        });
      } catch { /* best-effort */ }
    }

    return response;
  }

  /** Response-side prompt injection / exfiltration (parity with stdio proxy). */
  private inspectToolResponse(
    toolName: string,
    response: Record<string, unknown>,
    requestId: unknown,
  ): Record<string, unknown> | null {
    const result = (response as { result?: unknown }).result;
    if (result == null) return null;

    const responseText = JSON.stringify(result);
    const allDetections: string[] = [];
    if (this.opts.policy) {
      const { clean, detections } = this.opts.policy.evaluateResponse(
        toolName,
        this.opts.serverName,
        responseText,
      );
      if (!clean) allDetections.push(...detections);
    }

    const injectionFindings = detectPromptInjection(toolName, responseText);
    const hasCritical = injectionFindings.some((f) => f.severity === 'critical');
    const hasHigh = injectionFindings.some((f) => f.severity === 'high');
    const hasDetections = injectionFindings.length > 0 || allDetections.length > 0;

    if (!hasDetections) return null;

    const allMessages = [
      ...allDetections,
      ...injectionFindings.map(
        (f) => `${f.severity.toUpperCase()}: ${f.description} (${f.matchPreview})`,
      ),
    ];
    Logger.warn(
      `[sse-proxy:${this.opts.serverName}] Suspicious response from '${toolName}': ${allMessages.slice(0, 5).join('; ')}`,
    );
    StructuredLogger.info({
      event: 'response_flagged',
      serverName: this.opts.serverName,
      toolName,
      detections: allMessages,
      blocked: (hasCritical || hasHigh) && this.opts.policy?.getMode() === 'block',
    });
    Metrics.injectionDetectedTotal?.inc({
      server_name: this.opts.serverName,
      severity: hasCritical ? 'critical' : 'high',
    });

    const policyMode = this.opts.policy?.getMode() ?? 'audit';
    if ((hasCritical || hasHigh) && policyMode === 'block') {
      return {
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32002,
          message:
            'MCP Guardian: Tool response blocked — prompt injection detected in upstream response',
        },
      };
    }
    return null;
  }

  private _forwardToUpstream(
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.opts.upstreamUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;
      const payload = JSON.stringify(body);

      const reqOpts: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(this.opts.authHeader
            ? { Authorization: this.opts.authHeader }
            : {}),
        },
      };

      if (isHttps && this.httpsAgent) {
        reqOpts.agent = this.httpsAgent;
      }

      const req = client.request(reqOpts, (res) => {
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
