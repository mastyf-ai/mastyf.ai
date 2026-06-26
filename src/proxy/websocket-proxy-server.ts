/**
 * WebSocket MCP transport proxy — policy, auth, circuit breaker, audit parity with stdio.
 */
import { createServer, type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { PolicyEngine } from '../policy/policy-engine.js';
import { Logger } from '../utils/logger.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import {
  InvalidTenantIdError,
} from '../tenant/resolve-tenant.js';
import {
  JwtTenantRequiredError,
  resolveProxyTenantId,
} from '../tenant/jwt-tenant-binding.js';
import type { CallContext } from '../policy/policy-types.js';
import { applyGeoToCallContext } from '../utils/request-geo-context.js';
import type { IDatabase } from '../database/database-interface.js';
import { OAuthValidator } from '../auth/oauth.js';
import { createSessionCache, validateSessionToken, type MastyfAiSessionCache } from '../auth/session-factory.js';
import { extractDpopProof, validateRequiredDpop } from '../auth/dpop-enforcement.js';
import { notifyToolBlock } from '../alerting/notify-tool-block.js';
import { getCircuitBreaker } from '../utils/circuit-breaker-registry.js';
import { scanForSecrets } from '../scanners/secret-scanner.js';
import { findingsToMessages, isResponseScanSkipped, createStreamingInspectorState, type StreamingInspectorState } from '../utils/streaming-inspector.js';
import { inspectCostStreamingChunk } from '../agentic/response-dlp/cost-streaming-inspector.js';
import { withProxyRequestVault } from './proxy-request-context.js';
import { gateToolResponseText } from '../utils/response-security-gate.js';
import { persistCallRecord } from '../utils/call-record-cost.js';
import { TokenCounter } from '../utils/token-counter.js';
import { resolveModelIdForServer } from '../config/llm-config.js';
import * as Metrics from '../utils/metrics.js';
import { idempotencyKeyFromRequest } from '../policy/idempotency-store.js';
import type { AgentIdentity } from '../auth/auth-types.js';
import { sanitizeProxyClientError, webSocketClientOptions } from '../utils/ws-tls-config.js';
import { requireUpstreamTlsAllowed } from '../utils/upstream-tls.js';
import { injectRotatedSessionIntoResult } from '../utils/mcp-session-meta.js';
import { getUpstreamTimeoutMs } from '../utils/upstream-timeout.js';
import { getAnomalyDetector } from '../ai/anomaly-detector.js';
import {
  applyToolFingerprintFromResult,
  type ToolFingerprintState,
} from './tool-fingerprint.js';
import { publishRugPullAlert } from './rug-pull-cluster.js';
import { isProxyInflightExceeded, proxyMaxInflight } from './proxy-inflight.js';
import { isPostPolicyGateBlock, runPostPolicyAllowGates } from './proxy-post-allow-gates.js';
import {
  runWithExtractedTrace,
  withMcpToolCallSpan,
} from './trace-context.js';

export interface WebSocketProxyOptions {
  listenPort: number;
  upstreamWsUrl: string;
  serverName: string;
  policy?: PolicyEngine;
  db?: IDatabase;
  authValidator?: OAuthValidator;
}

export class WebSocketProxyServer {
  private opts: WebSocketProxyOptions;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private rugPullState: ToolFingerprintState = { fingerprint: null, blocked: false };
  private pendingToolCalls = new Map<string | number, string>();
  private pendingMcpMethods = new Map<string | number, string>();
  private pendingMcpSessions = new Map<string | number, string>();
  private pendingToolTenants = new Map<string | number, string>();
  private pendingStreamingCost = new Map<string | number, StreamingInspectorState>();
  private pendingSessionTokens = new Map<string | number, string>();
  private sessionCache: MastyfAiSessionCache | null;
  private tokenCounter = new TokenCounter();

  constructor(opts: WebSocketProxyOptions) {
    requireUpstreamTlsAllowed(opts.upstreamWsUrl);
    this.opts = opts;
    this.sessionCache = opts.authValidator ? createSessionCache() : null;
  }

  private applyRotatedSessionToMessage(msg: Record<string, unknown>, requestId: string | number): void {
    const rotated = this.pendingSessionTokens.get(requestId);
    this.pendingSessionTokens.delete(requestId);
    injectRotatedSessionIntoResult(msg, rotated);
  }

  async start(): Promise<void> {
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (clientWs, req) => {
      void this.handleClientConnection(clientWs, req);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(this.opts.listenPort, () => {
        this.httpServer!.removeListener('error', reject);
        Logger.info(
          `[ws-proxy:${this.opts.serverName}] Listening on ws://0.0.0.0:${this.opts.listenPort} → ${this.opts.upstreamWsUrl}`,
        );
        resolve();
      });
    });
  }

  getListenPort(): number {
    const addr = this.httpServer?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.opts.listenPort;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      this.httpServer?.close(() => resolve());
    });
  }

  private breakerFor(tenantId: string) {
    return getCircuitBreaker(tenantId, this.opts.serverName);
  }

  private async handleClientConnection(clientWs: WebSocket, req: IncomingMessage): Promise<void> {
    const upstream = new WebSocket(
      this.opts.upstreamWsUrl,
      undefined,
      webSocketClientOptions(this.opts.upstreamWsUrl),
    );
    const upstreamTimeoutMs = getUpstreamTimeoutMs();
    let connectSettled = false;
    const connectTimer = setTimeout(() => {
      if (connectSettled) return;
      connectSettled = true;
      try {
        upstream.terminate();
      } catch {
        /* ignore */
      }
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1011, sanitizeProxyClientError('upstream connect timeout'));
      }
    }, upstreamTimeoutMs);

    upstream.on('open', () => {
      connectSettled = true;
      clearTimeout(connectTimer);
      clientWs.on('message', (data) => {
        void this.interceptMessage(data, clientWs, upstream, req);
      });
      upstream.on('message', (data) => {
        void this.interceptUpstreamMessage(data, clientWs);
      });
    });

    upstream.on('error', (err) => {
      connectSettled = true;
      clearTimeout(connectTimer);
      Logger.warn(`[ws-proxy:${this.opts.serverName}] upstream error: ${err.message}`);
      clientWs.close(1011, sanitizeProxyClientError('upstream error'));
    });

    clientWs.on('close', () => {
      clearTimeout(connectTimer);
      upstream.close();
    });
    upstream.on('close', () => clientWs.close());
    clientWs.on('error', () => {
      clearTimeout(connectTimer);
      upstream.close();
    });
  }

  private async interceptUpstreamMessage(data: WebSocket.RawData, clientWs: WebSocket): Promise<void> {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
      return;
    }

    if (msg.result && typeof msg.result === 'object') {
      applyToolFingerprintFromResult(this.rugPullState, msg.result, {
        serverName: this.opts.serverName,
        tenantId: 'default',
        logPrefix: `[ws-proxy:${this.opts.serverName}]`,
        onMismatch: async () => {
          void publishRugPullAlert(
            this.opts.serverName,
            'default',
            this.rugPullState.fingerprint || '',
          );
        },
      });
    }

    if (msg.result && typeof msg.id !== 'undefined') {
      const requestId = msg.id as string | number;
      const mcpMethod = this.pendingMcpMethods.get(requestId);
      if (mcpMethod) {
        this.pendingMcpMethods.delete(requestId);
        const sessionId = this.pendingMcpSessions.get(requestId) ?? 'ws-session';
        this.pendingMcpSessions.delete(requestId);
        const { applyMcpResponsePipeline, mcpResponseBlockJson } = await import('./mcp-request-pipeline.js');
        const rp = applyMcpResponsePipeline({
          method: mcpMethod,
          result: (msg as { result: unknown }).result,
          sessionId,
        });
        if (rp.blocked) {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(mcpResponseBlockJson(requestId, rp.reason ?? 'blocked')));
          }
          return;
        }
        if (rp.result !== undefined) {
          (msg as { result: unknown }).result = rp.result;
        }
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(msg));
        return;
      }

      const toolName = this.pendingToolCalls.get(requestId) ?? 'unknown';
      const tenantId = this.pendingToolTenants.get(requestId);
      const costState = this.pendingStreamingCost.get(requestId);
      if (costState) {
        const costCheck = inspectCostStreamingChunk(costState, raw, tenantId);
        this.pendingStreamingCost.delete(requestId);
        if (costCheck.terminateStream) {
          this.pendingToolCalls.delete(requestId);
          this.pendingToolTenants.delete(requestId);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              jsonrpc: '2.0',
              id: requestId,
              error: {
                code: -32003,
                message: costCheck.reason ?? 'Streaming spend cap exceeded',
              },
            }));
          }
          return;
        }
      }
      this.pendingToolCalls.delete(requestId);
      this.pendingToolTenants.delete(requestId);
      const blocked = await this.inspectToolResponse(toolName, msg, requestId, tenantId);
      if (blocked) {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(blocked));
        return;
      }
      this.applyRotatedSessionToMessage(msg, requestId);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(msg));
      }
      return;
    }

    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(raw);
  }

  private async inspectToolResponse(
    toolName: string,
    response: Record<string, unknown>,
    requestId: string | number,
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
      requestId,
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
      `[ws-proxy:${this.opts.serverName}] Suspicious response from '${toolName}': ${allMessages.slice(0, 5).join('; ')}`,
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

  private async interceptMessage(
    data: WebSocket.RawData,
    clientWs: WebSocket,
    upstream: WebSocket,
    req: IncomingMessage,
  ): Promise<void> {
    const raw = typeof data === 'string' ? data : data.toString('utf-8');
    return runWithExtractedTrace(
      req.headers as Record<string, string | string[] | undefined>,
      () =>
        withProxyRequestVault(
          raw,
          req.headers as Record<string, string | string[] | undefined>,
          () => this.interceptMessageInner(raw, clientWs, upstream, req),
        ),
    );
  }

  private async interceptMessageInner(
    raw: string,
    clientWs: WebSocket,
    upstream: WebSocket,
    req: IncomingMessage,
  ): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(raw);
      return;
    }

    const { runMcpPrePipeline } = await import('./mcp-request-pipeline.js');
    const pre = runMcpPrePipeline({
      msg,
      serverName: this.opts.serverName,
      authenticated: Boolean(req.headers.authorization),
    });
    if (pre.blocked) {
      clientWs.send(JSON.stringify(pre.response));
      return;
    }
    if (pre.trackResponse && pre.requestMethod && msg.id != null) {
      this.pendingMcpMethods.set(msg.id as string | number, pre.requestMethod);
      this.pendingMcpSessions.set(msg.id as string | number, pre.session.sessionId);
    }

    if (msg.method === 'tools/call') {
      const params = msg.params as { name?: string } | undefined;
      if (msg.id != null) {
        if (isProxyInflightExceeded(this.pendingToolCalls.size)) {
          const max = proxyMaxInflight();
          Metrics.proxyInflightRejectedTotal.inc(
            Metrics.withTenantMetricLabels(
              { server_name: this.opts.serverName },
              'default',
            ),
          );
          clientWs.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              error: {
                code: -32005,
                message: `Mastyf AI: proxy overloaded (${this.pendingToolCalls.size}/${max} in flight)`,
              },
            }),
          );
          return;
        }
        if (params?.name) {
          this.pendingToolCalls.set(msg.id as string | number, params.name);
        }
      }
      if (this.rugPullState.blocked) {
        clientWs.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32001, message: 'Blocked: tool definitions changed mid-session (rug-pull)' },
        }));
        return;
      }

      const blocked = await withMcpToolCallSpan(
        {
          serverName: this.opts.serverName,
          toolName: (params?.name as string | undefined) ?? 'unknown',
          transport: 'websocket',
        },
        () => this.evaluateToolCall(msg, req),
      );
      if (blocked) {
        if (msg.id != null) {
          this.pendingToolCalls.delete(msg.id as string | number);
        }
        clientWs.send(JSON.stringify(blocked));
        return;
      }
    }

    if (upstream.readyState === WebSocket.OPEN) upstream.send(raw);
  }

  private async evaluateToolCall(
    msg: Record<string, unknown>,
    req: IncomingMessage,
  ): Promise<Record<string, unknown> | null> {
    if (!this.opts.policy) return null;

    let tenantId: string;
    let agentIdentity: AgentIdentity | undefined;
    let authenticated = false;
    const authHeader = req.headers['authorization'];
    const token = OAuthValidator.extractToken(
      typeof authHeader === 'string' ? authHeader : authHeader?.[0],
    );

    if (token && this.opts.authValidator) {
      const result = await this.opts.authValidator.validate(token);
      if (result.valid && result.identity) {
        authenticated = true;
        agentIdentity = result.identity;
      } else if (this.opts.authValidator.getConfig().required) {
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32002, message: result.error || 'Authentication required' },
        };
      }
    }

    try {
      tenantId = resolveProxyTenantId({
        headers: req.headers as Record<string, string | string[] | undefined>,
        meta: (msg.params as Record<string, unknown> | undefined)?._meta,
        jwtTenantId: agentIdentity?.tenantId,
        authenticated,
      });
    } catch (err) {
      if (err instanceof InvalidTenantIdError || err instanceof JwtTenantRequiredError) {
        return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: err.message } };
      }
      throw err;
    }

    if (token && this.sessionCache && !authenticated) {
      const sessionResult = await validateSessionToken(this.sessionCache, token, tenantId);
      if (sessionResult) {
        authenticated = true;
        agentIdentity = sessionResult.identity;
        if (sessionResult.rotatedToken && msg.id != null) {
          this.pendingSessionTokens.set(msg.id as string | number, sessionResult.rotatedToken);
        }
      } else if (this.opts.authValidator?.getConfig().required) {
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32002, message: 'Authentication required' },
        };
      }
    }

    const breaker = this.breakerFor(tenantId);
    if (!breaker.allowRequest()) {
      return {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32005, message: 'Upstream unavailable — circuit breaker open' },
      };
    }

    if (token) {
      const dpopCheck = await validateRequiredDpop(
        extractDpopProof({ headerDpop: req.headers['dpop'] }),
        'POST',
        `wss://${this.opts.serverName}/tools/call`,
        token,
        tenantId,
        this.opts.policy.getMode(),
      );
      if (!dpopCheck.valid) {
        breaker.recordFailure();
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
        agentId: agentIdentity?.sub,
        meta: params?._meta,
        headers: req.headers,
      },
    );
    if (preGuard.blocked) {
      breaker.recordFailure();
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

    if (params?.arguments) {
      const secrets = scanForSecrets(JSON.stringify(params.arguments), `ws:${this.opts.serverName}`);
      if (secrets.length > 0 && this.opts.policy.getMode() === 'block') {
        breaker.recordFailure();
        return {
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32001, message: 'Blocked: secrets detected in tool arguments' },
        };
      }
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
      agentIdentity,
      idempotencyKey: idempotencyKeyFromRequest(params?._meta),
    }, req.headers);

    const decision = await this.opts.policy.evaluateAsync(context);
    if (decision.action === 'block') {
      notifyToolBlock({
        serverName: this.opts.serverName,
        toolName: context.toolName,
        rule: decision.rule,
        reason: decision.reason,
        requestId: context.requestId,
        anomalyScore: 0.95,
      });
      breaker.recordFailure();
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
        error: { code: -32001, message: `Blocked by MCP Mastyf AI policy: ${decision.reason}` },
      };
    }

    const gateOutcome = await runPostPolicyAllowGates(context, decision, this.opts.serverName);
    if (isPostPolicyGateBlock(gateOutcome)) {
      breaker.recordFailure();
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
        error: { code: -32001, message: `Blocked by MCP Mastyf AI semantic gate: ${gateOutcome.reason}` },
      };
    }
    const spendReservationId =
      gateOutcome && 'allowed' in gateOutcome ? gateOutcome.spendReservationId : undefined;

    // ── Anomaly detection (ML pipeline) ────────────────────────────
    try {
      const anomalyDetector = getAnomalyDetector();
      const sessionKey = (params?._meta?.['sessionId'] as string | undefined) || String(context.requestId);
      const anomaly = await anomalyDetector.evaluate(
        this.opts.serverName,
        context.toolName,
        0,    // criticalCount (filled by argument scanner integration)
        0,    // warningCount
        0,    // maxConfidence
        {},   // categories
        sessionKey,
        tenantId,
      );

      if (anomaly.aboveThreshold && anomaly.confidence > 0.7) {
        Logger.warn(
          `[ws-proxy:${this.opts.serverName}] Anomaly detected: ${context.toolName} ` +
          `score=${anomaly.confidence.toFixed(3)} layer=${anomaly.primaryLayer}`,
        );
        if (process.env['MASTYF_AI_ANOMALY_BLOCK'] === 'true') {
          breaker.recordFailure();
          return {
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: -32001,
              message: `Blocked: anomalous behavior detected (score: ${anomaly.confidence.toFixed(2)}, layer: ${anomaly.primaryLayer})`,
            },
          };
        }
      }
    } catch {
      // Anomaly detection failure is non-fatal
    }

    breaker.recordSuccess();

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

    if (msg.id != null) {
      this.pendingToolTenants.set(msg.id as string | number, tenantId);
      this.pendingStreamingCost.set(msg.id as string | number, createStreamingInspectorState());
    }

    return null;
  }
}
