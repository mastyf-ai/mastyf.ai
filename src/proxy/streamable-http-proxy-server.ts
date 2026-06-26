/**
 * MCP streamable HTTP transport proxy.
 * POST /mcp — JSON-RPC batch or single message; policy on tools/call; optional upstream relay.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { randomUUID } from 'crypto';
import { URL } from 'url';
import { PolicyEngine } from '../policy/policy-engine.js';
import { Logger } from '../utils/logger.js';
import { requireUpstreamTlsAllowed } from '../utils/upstream-tls.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { notifyToolBlock } from '../alerting/notify-tool-block.js';
import { auditPolicyDecision } from './audit-policy-decision.js';
import { resolveTenantContext, InvalidTenantIdError } from '../tenant/resolve-tenant.js';
import { resolveProxyTenantId, JwtTenantRequiredError } from '../tenant/jwt-tenant-binding.js';
import { OAuthValidator } from '../auth/oauth.js';
import { extractDpopProof, validateRequiredDpop } from '../auth/dpop-enforcement.js';
import { createSessionCache, validateSessionToken, type MastyfAiSessionCache } from '../auth/session-factory.js';
import type { CallContext } from '../policy/policy-types.js';
import { applyGeoToCallContext } from '../utils/request-geo-context.js';
import type { IDatabase } from '../database/database-interface.js';
import { persistCallRecord } from '../utils/call-record-cost.js';
import { TokenCounter } from '../utils/token-counter.js';
import { resolveModelIdForServer } from '../config/llm-config.js';
import { idempotencyKeyFromRequest } from '../policy/idempotency-store.js';
import { gateToolResponseText } from '../utils/response-security-gate.js';
import { injectRotatedSessionIntoResult } from '../utils/mcp-session-meta.js';
import { getMtlsAgent } from '../utils/mtls-agent-registry.js';
import { parseJsonWithDepthLimit } from './http-proxy-security.js';
import { getUpstreamTimeoutMs } from '../utils/upstream-timeout.js';
import { acquireProxyInflight, releaseProxyInflight } from './proxy-inflight.js';
import { isPostPolicyGateBlock, runPostPolicyAllowGates } from './proxy-post-allow-gates.js';
import { withProxyRequestVault } from './proxy-request-context.js';
import {
  fingerprintJsonRpcToolsList,
  isRugPullBlockedForCall,
} from './rug-pull-transport.js';
import type { ToolFingerprintState } from './tool-fingerprint.js';
import {
  injectIntoUpstreamHeaders,
  runWithExtractedTraceAsync,
  withMcpToolCallSpan,
} from './trace-context.js';

export interface StreamableHttpProxyOptions {
  listenPort: number;
  upstreamBaseUrl: string;
  serverName: string;
  policy?: PolicyEngine;
  db?: IDatabase;
  authValidator?: OAuthValidator;
}

function isUpstreamRelayEnabled(): boolean {
  return process.env['MASTYF_AI_STREAMABLE_HTTP_UPSTREAM_RELAY'] === 'true';
}

export class StreamableHttpProxyServer {
  private opts: StreamableHttpProxyOptions;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private boundPort = 0;
  private sessionCache: MastyfAiSessionCache | null;
  private tokenCounter = new TokenCounter();
  private readonly rugPullState: ToolFingerprintState = { fingerprint: null, blocked: false };

  constructor(opts: StreamableHttpProxyOptions) {
    requireUpstreamTlsAllowed(opts.upstreamBaseUrl);
    this.opts = opts;
    this.sessionCache = opts.authValidator ? createSessionCache() : null;
    getMtlsAgent();
  }

  getListenPort(): number {
    return this.boundPort;
  }

  async start(): Promise<number> {
    if (this.httpServer) return this.boundPort;
    this.httpServer = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(this.opts.listenPort, () => {
        this.httpServer!.removeListener('error', reject);
        const addr = this.httpServer!.address();
        this.boundPort = typeof addr === 'object' && addr ? addr.port : this.opts.listenPort;
        Logger.info(
          `[streamable-http:${this.opts.serverName}] Listening on http://127.0.0.1:${this.boundPort}/mcp → ${this.opts.upstreamBaseUrl}`,
        );
        resolve();
      });
    });
    return this.boundPort;
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return;
    await new Promise<void>((r) => this.httpServer!.close(() => r()));
    this.httpServer = null;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url || '/').split('?')[0];
    if (req.method !== 'POST' || path !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Use POST /mcp for streamable HTTP MCP' }));
      return;
    }

    const { readRequestBodyWithLimit } = await import('./http-proxy-security.js');
    const { jsonRpcErrorBody } = await import('./json-rpc-utils.js');
    const bodyRead = await readRequestBodyWithLimit(req);
    if (!bodyRead.ok) {
      const msg = `Payload exceeds ${bodyRead.limit} byte limit (${bodyRead.bytes} bytes)`;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jsonRpcErrorBody(null, -32001, msg)));
      return;
    }
    const body = bodyRead.body;
    return withProxyRequestVault(
      body,
      req.headers as Record<string, string | string[] | undefined>,
      async () => {
        let messages: Record<string, unknown>[];
        try {
          const parsed = JSON.parse(body);
          messages = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }

        const responses: unknown[] = [];
        for (const msg of messages) {
          responses.push(await this.processMessage(msg, req));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responses.length === 1 ? responses[0] : responses));
      },
    );
  }

  private async processMessage(
    msg: Record<string, unknown>,
    req: IncomingMessage,
  ): Promise<unknown> {
    return runWithExtractedTraceAsync(req.headers, () => this.processMessageTraced(msg, req));
  }

  private async processMessageTraced(
    msg: Record<string, unknown>,
    req: IncomingMessage,
  ): Promise<unknown> {
    const { runMcpPrePipeline, applyMcpResponsePipeline, mcpResponseBlockJson } = await import(
      './mcp-request-pipeline.js'
    );
    const pre = runMcpPrePipeline({
      msg,
      serverName: this.opts.serverName,
      authenticated: Boolean(req.headers.authorization),
    });
    if (pre.blocked) return pre.response;

    const blocked = await this.maybeBlockMessage(msg, req, {
      mcpSessionId: pre.session.sessionId,
      agentId: pre.session.agentId !== 'unknown' ? pre.session.agentId : undefined,
    });
    if (blocked) return blocked;

    if (!isUpstreamRelayEnabled()) {
      if (msg.method === 'tools/call') {
        releaseProxyInflight(this.opts.serverName);
      }
      return {
        jsonrpc: '2.0',
        id: msg.id,
        result: { forwarded: true, note: 'upstream relay disabled — set MASTYF_AI_STREAMABLE_HTTP_UPSTREAM_RELAY=true' },
      };
    }

    let relayTenantId = 'default';
    try {
      relayTenantId = resolveTenantContext({
        headers: req.headers as Record<string, string | string[] | undefined>,
      }).tenantId;
    } catch {
      /* default */
    }

    const upstream = msg.method === 'tools/call'
      ? await withMcpToolCallSpan({
        serverName: this.opts.serverName,
        toolName: (msg.params as { name?: string } | undefined)?.name ?? 'unknown',
        tenantId: relayTenantId,
        transport: 'streamable-http',
      }, () => this.relayToUpstream(JSON.stringify(msg), req))
      : await this.relayToUpstream(JSON.stringify(msg), req);
    if (msg.method === 'tools/call') {
      releaseProxyInflight(this.opts.serverName);
    }
    if (!upstream || typeof upstream !== 'object') return upstream;

    let fpTenant = relayTenantId;
    fingerprintJsonRpcToolsList(
      this.rugPullState,
      upstream,
      this.opts.serverName,
      fpTenant,
      `[streamable-http:${this.opts.serverName}]`,
    );

    const rotated = (msg as { _rotatedSessionToken?: string })._rotatedSessionToken;
    if (rotated) {
      injectRotatedSessionIntoResult(upstream, rotated);
    }

    if (msg.method === 'tools/call' && (upstream as { result?: unknown }).result != null) {
      const params = msg.params as { name?: string } | undefined;
      const toolName = params?.name || 'unknown';
      let tenantId = 'default';
      try {
        tenantId = resolveTenantContext({
          headers: req.headers as Record<string, string | string[] | undefined>,
        }).tenantId;
      } catch {
        /* use default */
      }
      const gated = await gateToolResponseText({
        responseText: JSON.stringify((upstream as { result: unknown }).result),
        toolName,
        serverName: this.opts.serverName,
        policy: this.opts.policy,
        requestId: msg.id as string | number | undefined,
        tenantId,
      });
      if (gated.outcome.action === 'block') {
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32002, message: gated.outcome.message },
        };
      }
      if (gated.outcome.action === 'redact') {
        try {
          (upstream as { result: unknown }).result = JSON.parse(gated.outcome.body);
        } catch {
          /* keep */
        }
      }
    }

    if (!pre.blocked && pre.trackResponse && pre.requestMethod && (upstream as { result?: unknown }).result != null) {
      const rp = applyMcpResponsePipeline({
        method: pre.requestMethod,
        result: (upstream as { result: unknown }).result,
        sessionId: pre.session.sessionId,
      });
      if (rp.blocked) {
        return mcpResponseBlockJson(msg.id as string | number | null | undefined, rp.reason ?? 'Resource/prompt blocked');
      }
      if (rp.result !== undefined) {
        (upstream as { result: unknown }).result = rp.result;
      }
    }

    return upstream;
  }

  private relayToUpstream(
    body: string,
    req: IncomingMessage,
  ): Promise<Record<string, unknown> | null> {
    const base = this.opts.upstreamBaseUrl.replace(/\/$/, '');
    const url = new URL(`${base}/mcp`);
    const isHttps = url.protocol === 'https:';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
    };
    const auth = req.headers['authorization'];
    if (typeof auth === 'string') headers.Authorization = auth;
    const dpop = req.headers['dpop'];
    if (typeof dpop === 'string') headers.DPoP = dpop;
    const outboundHeaders = injectIntoUpstreamHeaders(headers);

    return new Promise((resolve) => {
      const reqOpts = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: outboundHeaders,
        timeout: getUpstreamTimeoutMs(),
        agent: isHttps ? getMtlsAgent() : undefined,
      };
      const clientReq = (isHttps ? httpsRequest : httpRequest)(reqOpts, (upstreamRes) => {
        const parts: Buffer[] = [];
        upstreamRes.on('data', (c) => parts.push(c));
        upstreamRes.on('end', () => {
          const text = Buffer.concat(parts).toString();
          const parsed = parseJsonWithDepthLimit(text);
          if (!parsed.ok) {
            resolve(null);
            return;
          }
          resolve(parsed.value as Record<string, unknown>);
        });
      });
      clientReq.on('error', (err) => {
        Logger.warn(`[streamable-http:${this.opts.serverName}] upstream error: ${err.message}`);
        resolve(null);
      });
      clientReq.on('timeout', () => {
        clientReq.destroy();
        resolve(null);
      });
      clientReq.write(body);
      clientReq.end();
    });
  }

  private async maybeBlockMessage(
    msg: Record<string, unknown>,
    req: IncomingMessage,
    fleetCtx?: { mcpSessionId?: string; agentId?: string },
  ): Promise<Record<string, unknown> | null> {
    if (msg.method !== 'tools/call' || !this.opts.policy) return null;

    let tenantId: string;
    let authenticated = false;
    let jwtTenantId: string | undefined;
    let agentSub: string | undefined = fleetCtx?.agentId;
    let rotatedSessionToken: string | undefined;
    const authHeader = req.headers['authorization'];
    const token = OAuthValidator.extractToken(
      typeof authHeader === 'string' ? authHeader : authHeader?.[0],
    );

    if (token && this.opts.authValidator) {
      const result = await this.opts.authValidator.validate(token);
      if (result.valid && result.identity) {
        authenticated = true;
        jwtTenantId = result.identity.tenantId;
        agentSub = result.identity.sub ?? agentSub;
      }
    }

    try {
      tenantId = resolveProxyTenantId({
        headers: req.headers as Record<string, string | string[] | undefined>,
        meta: (msg.params as Record<string, unknown> | undefined)?._meta,
        jwtTenantId,
        authenticated,
      });
    } catch (err) {
      if (err instanceof InvalidTenantIdError || err instanceof JwtTenantRequiredError) {
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32602, message: err.message },
        };
      }
      throw err;
    }

    if (await isRugPullBlockedForCall(this.rugPullState, this.opts.serverName, tenantId)) {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: -32001,
          message:
            'Blocked by MCP Mastyf AI policy: tool definitions changed mid-session (rug-pull)',
        },
      };
    }

    if (token && this.sessionCache && !authenticated) {
      const sessionResult = await validateSessionToken(this.sessionCache, token, tenantId);
      if (sessionResult) {
        authenticated = true;
        jwtTenantId = sessionResult.identity.tenantId;
        agentSub = sessionResult.identity.sub ?? agentSub;
        rotatedSessionToken = sessionResult.rotatedToken;
      }
    }

    if (token && this.opts.authValidator) {
      const dpopCheck = await validateRequiredDpop(
        extractDpopProof({ headerDpop: req.headers['dpop'] }),
        'POST',
        `https://streamable/${this.opts.serverName}/mcp`,
        token,
        tenantId,
        this.opts.policy.getMode(),
      );
      if (!dpopCheck.valid) {
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32004, message: dpopCheck.error || 'DPoP validation failed' },
        };
      }
    }

    const params = msg.params as {
      name?: string;
      arguments?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    } | undefined;
    const toolName = params?.name || 'unknown';
    const requestId = String(msg.id ?? randomUUID());
    const { runToolCallPreForwardGuard, toolCallGuardBlockResponse } = await import(
      './tool-call-pre-guard.js'
    );
    const preGuard = await runToolCallPreForwardGuard(
      this.opts.serverName,
      toolName,
      params?.arguments,
      requestId,
      {
        meta: params?._meta,
        headers: req.headers,
        agentId: agentSub,
        mcpSessionId: fleetCtx?.mcpSessionId,
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
      return toolCallGuardBlockResponse(msg.id, preGuard);
    }
    if (preGuard.arguments && params) {
      params.arguments = preGuard.arguments;
    }
    const reqMsg = { params: { name: params?.name, arguments: params?.arguments } };
    const model = resolveModelIdForServer(this.opts.serverName);
    const tokenCounts = this.tokenCounter.countProxyCall({
      requestText: JSON.stringify(reqMsg),
      responseText: '',
      model,
      requestPayload: reqMsg,
    });
    const context: CallContext = applyGeoToCallContext({
      serverName: this.opts.serverName,
      toolName,
      arguments: params?.arguments,
      requestId,
      requestTokens: tokenCounts.requestTokens,
      timestamp: new Date().toISOString(),
      tenantId,
      idempotencyKey: idempotencyKeyFromRequest(params?._meta),
    }, req.headers);

    const inflight = acquireProxyInflight(this.opts.serverName);
    if (!inflight.ok) {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: -32005,
          message: `Mastyf AI: proxy overloaded (${inflight.current}/${inflight.max} in flight)`,
        },
      };
    }

    const decision = await this.opts.policy.evaluateAsync(context);
    auditPolicyDecision(context.requestId, this.opts.serverName, context.toolName, decision, context);
    if (decision.action === 'block') {
      notifyToolBlock({
        serverName: this.opts.serverName,
        toolName: context.toolName,
        rule: decision.rule,
        reason: decision.reason,
        requestId: context.requestId,
        anomalyScore: 0.95,
      });
      releaseProxyInflight(this.opts.serverName);
      StructuredLogger.logBlocked({
        event: 'tool_blocked',
        requestId: context.requestId,
        serverName: this.opts.serverName,
        toolName: context.toolName,
        reason: decision.reason,
        rule: decision.rule,
      });
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: -32001,
          message: `Blocked by MCP Mastyf AI policy: ${decision.reason}`,
        },
      };
    }

    const gateOutcome = await runPostPolicyAllowGates(context, decision, this.opts.serverName);
    if (isPostPolicyGateBlock(gateOutcome)) {
      releaseProxyInflight(this.opts.serverName);
      StructuredLogger.logBlocked({
        event: 'tool_blocked',
        requestId,
        serverName: this.opts.serverName,
        toolName,
        reason: gateOutcome.reason,
        rule: 'semantic_gate',
      });
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: {
          code: -32001,
          message: `Blocked by MCP Mastyf AI semantic gate: ${gateOutcome.reason}`,
        },
      };
    }
    const spendReservationId =
      gateOutcome && 'allowed' in gateOutcome ? gateOutcome.spendReservationId : undefined;

    if (this.opts.db) {
      persistCallRecord(
        this.opts.db,
        {
          serverName: this.opts.serverName,
          toolName: context.toolName,
          timestamp: context.timestamp,
          requestTokens: tokenCounts.requestTokens,
          responseTokens: tokenCounts.responseTokens,
          totalTokens: tokenCounts.totalTokens,
          tokenSource: tokenCounts.tokenSource,
          model,
          durationMs: 0,
          tenantId,
          spendReservationId,
        },
        msg,
      ).catch(() => undefined);
    }

    if (rotatedSessionToken) {
      (msg as { _rotatedSessionToken?: string })._rotatedSessionToken = rotatedSessionToken;
    }

    return null;
  }

}
