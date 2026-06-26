import http from 'http';
import https from 'https';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { URL } from 'url';
import { PolicyEngine } from '../policy/policy-engine.js';
import { findingsToMessages, isResponseScanSkipped } from '../utils/streaming-inspector.js';
import { gateToolResponseText } from '../utils/response-security-gate.js';
import { TokenCounter, extractModelFromPayload } from '../utils/token-counter.js';
import { Logger } from '../utils/logger.js';
import { requireUpstreamTlsAllowed } from '../utils/upstream-tls.js';
import { persistCallRecord } from '../utils/call-record-cost.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { auditPolicyDecision } from './audit-policy-decision.js';
import * as Metrics from '../utils/metrics.js';
import { resolveModelId, resolveModelIdForServer } from '../config/llm-config.js';
import type { MtlsConfig } from '../utils/mtls-config.js';
import { getMtlsAgent } from '../utils/mtls-agent-registry.js';
import { resolveTenantContext, InvalidTenantIdError } from '../tenant/resolve-tenant.js';
import type { CallContext } from '../policy/policy-types.js';
import { applyGeoToCallContext } from '../utils/request-geo-context.js';
import { getHttpMaxBodyBytes } from './http-proxy-security.js';
import { getUpstreamTimeoutMs } from '../utils/upstream-timeout.js';
import { acquireProxyInflight, releaseProxyInflight } from './proxy-inflight.js';
import { runSyncSemanticRequestGate } from './proxy-post-policy-gates.js';
import { hasJsonRpcId } from './json-rpc-utils.js';
import {
  fingerprintJsonRpcToolsList,
  isRugPullBlockedForCall,
} from './rug-pull-transport.js';
import type { ToolFingerprintState } from './tool-fingerprint.js';

interface SseProxyOptions {
  upstreamUrl: string;
  serverName: string;
  policy?: PolicyEngine;
  db: import('../database/database-interface.js').IDatabase;
  authHeader?: string;
  mtlsConfig?: MtlsConfig;
  /** Local listen port (0 = ephemeral). Set via MASTYF_AI_SSE_PROXY_PORT or config. */
  listenPort?: number;
}

interface SseSession {
  id: string;
  upstreamSessionId: string;
  upstreamMessageUrl: URL;
  upstreamSseReq?: http.ClientRequest;
  createdAt: number;
}

/**
 * MCP HTTP+SSE transport proxy.
 * - GET /sse (or /) — long-lived event stream; relays upstream SSE; exposes local /message endpoint
 * - POST /message?sessionId=... — JSON-RPC with policy + token accounting on tools/call
 * - interceptAndForward() — programmatic API (tests, direct integration)
 */
export class SseProxyServer extends EventEmitter {
  private opts: SseProxyOptions;
  private tokenCounter: TokenCounter;
  private sessions = new Map<string, SseSession>();
  private httpServer: Server | null = null;
  private boundPort = 0;
  private readonly rugPullState: ToolFingerprintState = { fingerprint: null, blocked: false };

  constructor(opts: SseProxyOptions) {
    super();
    requireUpstreamTlsAllowed(opts.upstreamUrl);
    this.opts = opts;
    this.tokenCounter = new TokenCounter();
    void opts.mtlsConfig;
    getMtlsAgent();
    if (getMtlsAgent()) {
      Logger.info(`[sse-proxy:${opts.serverName}] mTLS enabled for upstream connection`);
    }
  }

  getListenPort(): number {
    return this.boundPort;
  }

  async start(listenPort?: number): Promise<number> {
    if (this.httpServer) return this.boundPort;
    const port =
      listenPort ??
      this.opts.listenPort ??
      (parseInt(process.env['MASTYF_AI_SSE_PROXY_PORT'] || '0', 10) || 0);

    this.httpServer = createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(port, () => {
        this.httpServer!.removeListener('error', reject);
        const addr = this.httpServer!.address();
        this.boundPort = typeof addr === 'object' && addr ? addr.port : port;
        Logger.info(
          `[sse-proxy:${this.opts.serverName}] Listening on http://127.0.0.1:${this.boundPort} → ${this.opts.upstreamUrl}`,
        );
        resolve();
      });
    });
    return this.boundPort;
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.upstreamSseReq?.destroy();
    }
    this.sessions.clear();
    if (this.httpServer) {
      await new Promise<void>((r) => this.httpServer!.close(() => r()));
      this.httpServer = null;
    }
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (req.method === 'GET' && (path === '/' || path === '/sse')) {
      await this.handleSseGet(req, res, url);
      return;
    }

    if (req.method === 'POST' && (path === '/message' || path.endsWith('/message'))) {
      await this.handleMessagePost(req, res, url);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found — use GET /sse and POST /message' }));
  }

  private async handleSseGet(
    _req: IncomingMessage,
    res: ServerResponse,
    clientUrl: URL,
  ): Promise<void> {
    const sessionId = randomUUID();
    const upstreamBase = new URL(this.opts.upstreamUrl.replace(/\/$/, ''));
    const upstreamPaths = ['/', '/sse', upstreamBase.pathname || '/'].filter(
      (p, i, arr) => arr.indexOf(p) === i,
    );

    let upstreamSessionId: string | null = null;
    let upstreamMessageUrl: URL | null = null;

    for (const ssePath of upstreamPaths) {
      const probe = new URL(upstreamBase.href);
      probe.pathname = ssePath === '/' ? probe.pathname || '/' : ssePath;
      const discovered = await this.discoverUpstreamSession(probe);
      if (discovered) {
        upstreamSessionId = discovered.sessionId;
        upstreamMessageUrl = discovered.messageUrl;
        break;
      }
    }

    if (!upstreamSessionId || !upstreamMessageUrl) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to establish upstream SSE session' }));
      return;
    }

    const session: SseSession = {
      id: sessionId,
      upstreamSessionId,
      upstreamMessageUrl,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const localMessage = new URL(clientUrl.href);
    localMessage.pathname = '/message';
    localMessage.search = `sessionId=${sessionId}`;
    res.write(`event: endpoint\ndata: ${localMessage.pathname}${localMessage.search}\n\n`);

    const upstreamSseUrl = new URL(upstreamBase.href);
    upstreamSseUrl.pathname = upstreamMessageUrl.pathname.replace(/\/message.*$/, '') || '/sse';
    if (upstreamSseUrl.pathname === '/') upstreamSseUrl.pathname = '/sse';

    const isHttps = upstreamSseUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const reqOpts: https.RequestOptions = {
      hostname: upstreamSseUrl.hostname,
      port: upstreamSseUrl.port || (isHttps ? 443 : 80),
      path: upstreamSseUrl.pathname + upstreamSseUrl.search,
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(this.opts.authHeader ? { Authorization: this.opts.authHeader } : {}),
      },
    };
    const agent = getMtlsAgent();
    if (isHttps && agent) reqOpts.agent = agent;

    const upstreamReq = client.request(reqOpts, (upstreamRes) => {
      upstreamRes.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const rewritten = text.replace(
          /sessionId=([^&\s]+)/g,
          `sessionId=${sessionId}`,
        );
        if (!res.writableEnded) res.write(rewritten);
      });
      upstreamRes.on('end', () => {
        if (!res.writableEnded) res.end();
        this.sessions.delete(sessionId);
      });
    });
    upstreamReq.on('error', (err) => {
      Logger.warn(`[sse-proxy:${this.opts.serverName}] upstream SSE error: ${err.message}`);
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        res.end();
      }
      this.sessions.delete(sessionId);
    });
    session.upstreamSseReq = upstreamReq;
    upstreamReq.end();

    reqOnClose(res, () => {
      upstreamReq.destroy();
    });
  }

  private async handleMessagePost(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing sessionId query parameter' }));
      return;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unknown sessionId: ${sessionId}` }));
      return;
    }
    const body = await readRequestBody(req);
    let jsonRpc: Record<string, unknown>;
    try {
      jsonRpc = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    try {
      const result = await this.interceptAndForward(
        jsonRpc,
        req.headers as Record<string, string | string[] | undefined>,
        session,
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[sse-proxy:${this.opts.serverName}] message forward failed: ${message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  }

  private async discoverUpstreamSession(
    sseUrl: URL,
  ): Promise<{ sessionId: string; messageUrl: URL } | null> {
    const isHttps = sseUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    return new Promise((resolve) => {
      const reqOpts: https.RequestOptions = {
        hostname: sseUrl.hostname,
        port: sseUrl.port || (isHttps ? 443 : 80),
        path: sseUrl.pathname + sseUrl.search,
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          ...(this.opts.authHeader ? { Authorization: this.opts.authHeader } : {}),
        },
        timeout: 5000,
      };
      const probeAgent = getMtlsAgent();
      if (isHttps && probeAgent) reqOpts.agent = probeAgent;

      const req = client.request(reqOpts, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          const next = appendSseChunk(data, chunk);
          if (next === null) {
            req.destroy();
            resolve(null);
            return;
          }
          data = next;
          const parsed = parseEndpointFromSse(data, sseUrl);
          if (parsed) {
            req.destroy();
            resolve(parsed);
          }
        });
        res.on('end', () => {
          resolve(parseEndpointFromSse(data, sseUrl));
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  }

  async interceptAndForward(
    jsonRpcRequest: Record<string, unknown>,
    requestHeaders?: Record<string, string | string[] | undefined>,
    session?: SseSession,
  ): Promise<Record<string, unknown>> {
    const { runMcpPrePipeline, applyMcpResponsePipeline, mcpResponseBlockJson } = await import(
      './mcp-request-pipeline.js'
    );
    const pre = runMcpPrePipeline({
      msg: jsonRpcRequest,
      serverName: this.opts.serverName,
      authenticated: Boolean(this.opts.authHeader),
      fallbackSessionKey: session?.id,
    });
    if (pre.blocked) return pre.response;

    const isToolCall = jsonRpcRequest.method === 'tools/call';
    let resolvedTenantId = 'default';

    if (isToolCall && this.opts.policy) {
      let tenantId: string;
      try {
        tenantId = resolveTenantContext({
          headers: requestHeaders,
          meta: (jsonRpcRequest.params as Record<string, unknown> | undefined)?._meta,
        }).tenantId;
      } catch (err) {
        if (err instanceof InvalidTenantIdError) {
          return {
            jsonrpc: '2.0',
            id: jsonRpcRequest.id,
            error: { code: -32602, message: err.message },
          };
        }
        throw err;
      }
      const inflight = acquireProxyInflight(this.opts.serverName);
      if (!inflight.ok) {
        return {
          jsonrpc: '2.0',
          id: jsonRpcRequest.id,
          error: {
            code: -32005,
            message: `Mastyf AI: proxy overloaded (${inflight.current}/${inflight.max} in flight)`,
          },
        };
      }
      resolvedTenantId = tenantId;
      if (await isRugPullBlockedForCall(this.rugPullState, this.opts.serverName, tenantId)) {
        return {
          jsonrpc: '2.0',
          id: jsonRpcRequest.id,
          error: {
            code: -32001,
            message:
              'Blocked by MCP Mastyf AI policy: tool definitions changed mid-session (rug-pull)',
          },
        };
      }
      const toolName = (jsonRpcRequest.params as { name?: string })?.name || 'unknown';
      let requestArguments = (jsonRpcRequest.params as { arguments?: Record<string, unknown> })
        ?.arguments;
      const requestId = String(jsonRpcRequest.id ?? 'sse-request');
      const { runToolCallPreForwardGuard, toolCallGuardBlockResponse } = await import(
        './tool-call-pre-guard.js'
      );
      const preGuard = await runToolCallPreForwardGuard(
        this.opts.serverName,
        toolName,
        requestArguments,
        requestId,
        {
          meta: (jsonRpcRequest.params as Record<string, unknown> | undefined)?._meta as Record<string, unknown> | undefined,
          headers: requestHeaders,
          mcpSessionId: session?.id ?? pre.session.sessionId,
          agentId: pre.session.agentId !== 'unknown' ? pre.session.agentId : undefined,
        },
      );
      if (preGuard.blocked) {
        releaseProxyInflight(this.opts.serverName);
        StructuredLogger.logBlocked({
          event: 'tool_blocked',
          requestId,
          serverName: this.opts.serverName,
          toolName,
          reason: preGuard.message,
          rule: 'payload_or_agentic',
        });
        return toolCallGuardBlockResponse(jsonRpcRequest.id, preGuard);
      }
      if (preGuard.arguments) {
        requestArguments = preGuard.arguments;
        const params = jsonRpcRequest.params as Record<string, unknown>;
        if (params) params.arguments = requestArguments;
      }

      const context: CallContext = applyGeoToCallContext({
        serverName: this.opts.serverName,
        toolName,
        arguments: requestArguments,
        requestId,
        requestTokens: this.tokenCounter.count(JSON.stringify(jsonRpcRequest)),
        timestamp: new Date().toISOString(),
        tenantId,
      }, requestHeaders);
      const decision = await this.opts.policy.evaluateAsync(context);
      auditPolicyDecision(requestId, this.opts.serverName, toolName, decision, context);
      if (decision.action === 'block') {
        releaseProxyInflight(this.opts.serverName);
        StructuredLogger.logBlocked({
          event: 'tool_blocked',
          requestId,
          serverName: this.opts.serverName,
          toolName,
          reason: decision.reason,
          rule: decision.rule,
        });
        this.emit('blocked', { serverName: this.opts.serverName, reason: decision.reason });
        return {
          jsonrpc: '2.0',
          id: jsonRpcRequest.id,
          error: {
            code: -32001,
            message: `Blocked by MCP Mastyf AI policy: ${decision.reason}`,
          },
        };
      }

      const semGate = await runSyncSemanticRequestGate(context, decision, this.opts.serverName);
      if (semGate.block) {
        releaseProxyInflight(this.opts.serverName);
        return {
          jsonrpc: '2.0',
          id: jsonRpcRequest.id,
          error: {
            code: -32001,
            message: `Blocked by MCP Mastyf AI semantic gate: ${semGate.reason}`,
          },
        };
      }
    }

    const startMs = Date.now();
    let response = await this._forwardToUpstream(jsonRpcRequest, session);
    fingerprintJsonRpcToolsList(
      this.rugPullState,
      response,
      this.opts.serverName,
      resolvedTenantId,
      `[sse-proxy:${this.opts.serverName}]`,
    );
    if (isToolCall) {
      releaseProxyInflight(this.opts.serverName);
    }
    const durationMs = Date.now() - startMs;

    if (!pre.blocked && pre.trackResponse && pre.requestMethod && (response as { result?: unknown }).result != null) {
      const rp = applyMcpResponsePipeline({
        method: pre.requestMethod,
        result: (response as { result: unknown }).result,
        sessionId: pre.session.sessionId,
        latencyMs: durationMs,
      });
      if (rp.blocked) {
        return mcpResponseBlockJson(jsonRpcRequest.id as string | number | null | undefined, rp.reason ?? 'Resource/prompt blocked');
      }
      if (rp.result !== undefined) {
        (response as { result: unknown }).result = rp.result;
      }
    }

    if (isToolCall) {
      const toolName = (jsonRpcRequest.params as { name?: string } | undefined)?.name ?? 'unknown';
      const blockedResponse = await this.inspectToolResponse(
        toolName,
        response,
        jsonRpcRequest.id,
        resolvedTenantId,
      );
      if (blockedResponse) return blockedResponse;
    }

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
      } catch {
        /* best-effort */
      }
    }

    return response;
  }

  private async inspectToolResponse(
    toolName: string,
    response: Record<string, unknown>,
    requestId: unknown,
    tenantId?: string,
  ): Promise<Record<string, unknown> | null> {
    const result = (response as { result?: unknown }).result;
    if (result == null || isResponseScanSkipped()) return null;

    const responseText = JSON.stringify(result);
    const gate = await gateToolResponseText({
      responseText,
      toolName,
      serverName: this.opts.serverName,
      policy: this.opts.policy,
      requestId: requestId as string | number | undefined,
      tenantId,
    });
    const inspect = gate.inspect;
    if (!inspect || inspect.clean) {
      if (gate.outcome.action === 'redact' && gate.outcome.body) {
        try {
          (response as { result: unknown }).result = JSON.parse(gate.outcome.body);
        } catch {
          /* keep upstream */
        }
      }
      return null;
    }

    const hasCritical = inspect.hasCritical;
    const hasHigh = inspect.hasHigh;
    const allMessages = findingsToMessages(inspect.findings);
    Logger.warn(
      `[sse-proxy:${this.opts.serverName}] Suspicious response from '${toolName}': ${allMessages.slice(0, 5).join('; ')}`,
    );
    StructuredLogger.info({
      event: 'response_flagged',
      serverName: this.opts.serverName,
      toolName,
      detections: allMessages,
      blocked: gate.outcome.action === 'block',
    });
    Metrics.injectionDetectedTotal?.inc({
      server_name: this.opts.serverName,
      severity: hasCritical ? 'critical' : 'high',
    });

    if (gate.outcome.action === 'redact') {
      try {
        (response as { result: unknown }).result = JSON.parse(gate.outcome.body);
      } catch {
        /* keep upstream */
      }
      return null;
    }

    if (gate.outcome.action === 'block') {
      return {
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32002,
          message: gate.outcome.message,
        },
      };
    }
    return null;
  }

  private _forwardToUpstream(
    body: Record<string, unknown>,
    session?: SseSession,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let targetUrl: URL;
      if (session) {
        targetUrl = new URL(session.upstreamMessageUrl.href);
        targetUrl.searchParams.set('sessionId', session.upstreamSessionId);
      } else {
        targetUrl = new URL(this.opts.upstreamUrl);
      }

      const isHttps = targetUrl.protocol === 'https:';
      const client = isHttps ? https : http;
      const payload = JSON.stringify(body);

      const reqOpts: https.RequestOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(this.opts.authHeader ? { Authorization: this.opts.authHeader } : {}),
        },
        timeout: getUpstreamTimeoutMs(),
      };

      const fwdAgent = getMtlsAgent();
      if (isHttps && fwdAgent) {
        reqOpts.agent = fwdAgent;
      }

      const req = client.request(reqOpts, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          const next = appendSseChunk(data, chunk);
          if (next === null) {
            req.destroy();
            reject(new Error('Upstream SSE response exceeded max body size'));
            return;
          }
          data = next;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Upstream returned non-JSON: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Upstream request timed out after 30s'));
      });
      req.write(payload);
      req.end();
    });
  }
}

function appendSseChunk(current: string, chunk: Buffer): string | null {
  const max = getHttpMaxBodyBytes();
  if (current.length + chunk.length > max) return null;
  return current + chunk.toString();
}

function parseEndpointFromSse(
  data: string,
  baseUrl: URL,
): { sessionId: string; messageUrl: URL } | null {
  const lines = data.split('\n');
  let currentEvent: string | null = null;
  for (const line of lines) {
    if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
    else if (line.startsWith('data: ') && currentEvent === 'endpoint') {
      const endpointData = line.slice(6).trim();
      const m = endpointData.match(/sessionId=([^&\s]+)/);
      if (!m) return null;
      const sessionId = m[1]!;
      try {
        const messageUrl = endpointData.startsWith('http')
          ? new URL(endpointData)
          : new URL(endpointData, baseUrl);
        return { sessionId, messageUrl };
      } catch {
        const messageUrl = new URL(`/message?sessionId=${sessionId}`, baseUrl);
        return { sessionId, messageUrl };
      }
    }
  }
  return null;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const { readRequestBodyWithLimit } = await import('./http-proxy-security.js');
  const result = await readRequestBodyWithLimit(req);
  if (!result.ok) {
    const err = new Error('Request body too large') as Error & { tooLarge: boolean };
    err.tooLarge = true;
    throw err;
  }
  return result.body;
}

function reqOnClose(res: ServerResponse, fn: () => void): void {
  res.on('close', fn);
  res.on('error', fn);
}
