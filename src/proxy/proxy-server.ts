import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import {
  TokenCounter,
  countAudioTokensInPayload,
  countImageTokensInPayload,
  extractModelFromPayload,
} from '../utils/token-counter.js';
import { ProxyCallRecord } from '../types.js';
import { IDatabase } from '../database/database-interface.js';
import { Logger } from '../utils/logger.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { waitProxyTimingNormalize } from '../policy/policy-timing-envelope.js';
import { CallContext } from '../policy/policy-types.js';
import { applyGeoToCallContext } from '../utils/request-geo-context.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { OAuthValidator } from '../auth/oauth.js';
import { AuthValidationResult, AgentIdentity } from '../auth/auth-types.js';
import { createSessionCache, validateSessionToken, type MastyfAiSessionCache } from '../auth/session-factory.js';
import { getCircuitBreaker } from '../utils/circuit-breaker-registry.js';
import { ProxyRequestContextStore, proxyContextTtlMs, releaseSpendReservation, withProxyRequestVault, type ProxyRequestContext } from './proxy-request-context.js';
import { StdioLineWriter } from './proxy-stdio-writer.js';
import { JsonRpcResponseTracker } from './proxy-jsonrpc-response.js';
import { ProxySessionAuthStore } from './proxy-session-auth.js';
import { resolveTenantContext, DEFAULT_TENANT_ID, InvalidTenantIdError } from '../tenant/resolve-tenant.js';
import { JwtTenantRequiredError, resolveProxyTenantId } from '../tenant/jwt-tenant-binding.js';
import { idempotencyKeyFromRequest } from '../policy/idempotency-store.js';
import { RequestIdLock } from '../utils/request-id-lock.js';
import { scanMultimodalContent } from '../scanners/multimodal-content-scanner.js';
import type { TenantPolicyRegistry } from '../policy/tenant-policy-registry.js';
import { isResponseScanSkipped } from '../utils/streaming-inspector.js';
import { inspectToolResponse as sharedInspectToolResponse } from './response-inspection.js';
import {
  flowSessionKey,
} from '../policy/session-flow-guard.js';
import { recordSensitiveResponseAccess } from '../policy/session-flow-store.js';
import { scanForSecrets } from '../scanners/secret-scanner.js';
import { isProxyEntropyCheckEnabled, scanArgumentEntropy } from '../utils/arg-entropy.js';
import * as Metrics from '../utils/metrics.js';
import { notifyToolBlock } from '../alerting/notify-tool-block.js';
import { withMcpToolCallSpan, runWithExtractedTraceAsync } from './trace-context.js';
import { persistCallRecord } from '../utils/call-record-cost.js';
import {
  agenticRecordCompletedToolCall,
  agenticRecordDeniedToolCall,
  buildAgenticToolCallContext,
} from './agentic-hooks-bridge.js';
import {
  recordBlockLearningEvent,
  fingerprintArgs,
  redactArgSnippets,
  redactArguments,
  ingestPolicyDecision,
} from '../ai/block-learning.js';
import { evaluateToolCallDefense } from './tool-call-defense-orchestrator.js';
import { publishRugPullAlert, isClusterRugPullActive } from './rug-pull-cluster.js';
import { onToolsListObserved } from './lifecycle-assurance-gates.js';
import {
  applyToolFingerprintFromResult,
  type ToolFingerprintState,
} from './tool-fingerprint.js';
import { isProxyInflightExceeded, proxyMaxInflight } from './proxy-inflight.js';
import { resolveToolTimeoutMs } from '../utils/tool-timeout.js';
import type { HistoryDatabase } from '../database/history-db.js';
import { resolveModelId, resolveModelIdForServer } from '../config/llm-config.js';
import { extractDpopProof, validateRequiredDpop } from '../auth/dpop-enforcement.js';
import { startMemoryMonitor } from '../utils/memory-monitor.js';
import { hasJsonRpcId } from './json-rpc-utils.js';
import {
  checkExpandedPayload,
  checkRawPayloadSize,
  getMaxPayloadBytes,
} from './payload-guard.js';
import {
  applyMcpResponsePipeline,
  mcpResponseBlockJson,
  runMcpPrePipeline,
} from './mcp-request-pipeline.js';

const RESTART_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000]; // Exponential

/**
 * MCP Proxy Interceptor — sits between the AI client and an MCP server.
 *
 * v0.4: Integrated PolicyEngine for active blocking of malicious tool calls.
 * v0.5: OAuth 2.1 JWT validation — validates bearer tokens before policy evaluation.
 * v0.5.2: Circuit breaker for upstream MCP server failures.
 * v0.5.2: Per-client rate limiting (keyed by agent sub + tool name).
 * v0.5.2: Consistent SIEM fields (request_id, proxy_latency_ms, authn_success, authz_allowed).
 * v2.2: Payload size guard (MAX_PAYLOAD_BYTES) + exponential backoff on child restart.
 */
export class McpProxyServer {
  private child!: ChildProcess; // Definitely assigned in spawnChild()
  private tokenCounter: TokenCounter;
  private db: IDatabase;
  private currentRequestId: string | number | null = null;
  private readonly requestContexts = new ProxyRequestContextStore();
  private readonly stdoutWriter = new StdioLineWriter();
  private readonly responseTracker = new JsonRpcResponseTracker();
  private readonly sessionAuth = new ProxySessionAuthStore();
  private contextTtlTimer: ReturnType<typeof setInterval> | null = null;
  private serverName: string;
  private defaultTenantId: string;
  private policyEngine: PolicyEngine | null;
  private pendingPolicyEngine: PolicyEngine | null = null;
  private policyEvalInflight = 0;
  private tenantPolicyRegistry: TenantPolicyRegistry | null;
  private authValidator: OAuthValidator | null;
  private sessionCache: MastyfAiSessionCache | null;
  private readonly clientInputQueue = new RequestIdLock();
  private stopMemoryMonitor: (() => void) | null = null;

  /** OWASP MCP03 rug-pull fingerprint state (tools/list). */
  private rugPullState: ToolFingerprintState = { fingerprint: null, blocked: false };
  /** Pending tools/list JSON-RPC ids awaiting correlated responses. */
  private pendingToolsListIds = new Set<string | number>();
  private mcpSessionId: string | null = null;
  private mcpAgentId: string | null = null;

  private requestTimeoutMs: number;
  private restartCount: number = 0;
  private maxRestarts: number;
  private spawnCommand: string;
  private spawnArgs: string[];
  private spawnEnv: Record<string, string>;

  constructor(
    command: string,
    args: string[],
    env: Record<string, string>,
    db: IDatabase,
    serverName?: string,
    policyEngine?: PolicyEngine,
    authValidator?: OAuthValidator,
    requestTimeoutMs: number = 30000,
    maxRestarts: number = 5,
    tenantPolicyRegistry?: TenantPolicyRegistry,
  ) {
    this.serverName = serverName || command.split('/').pop() || command;
    this.defaultTenantId = resolveTenantContext().tenantId;
    this.policyEngine = policyEngine || null;
    this.tenantPolicyRegistry = tenantPolicyRegistry ?? null;
    this.authValidator = authValidator || null;
    this.sessionCache = authValidator ? createSessionCache() : null;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxRestarts = maxRestarts;
    this.spawnCommand = command;
    this.spawnArgs = args || [];
    // Explicit env — do NOT leak parent process secrets to child
    this.spawnEnv = { ...env } as Record<string, string>;
    // Only pass whitelisted system env vars to child processes
    const SAFE_ENV_KEYS = new Set([
      'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TZ',
      'NODE_PATH', 'NODE_ENV',
      // Allow explicit MCP-related env vars
      'MASTYF_AI_MAX_PAYLOAD_BYTES',
    ]);
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && SAFE_ENV_KEYS.has(k)) {
        (this.spawnEnv as any)[k] = v;
      }
    }
    this.tokenCounter = new TokenCounter();
    this.db = db;

    Metrics.circuitBreakerState.set({ server_name: this.serverName }, 0);
    this.spawnChild();
    if (process.env['MASTYF_AI_MEMORY_MONITOR'] !== 'false') {
      this.stopMemoryMonitor = startMemoryMonitor({ label: this.serverName });
    }
    const ttlMs = proxyContextTtlMs(this.requestTimeoutMs);
    this.contextTtlTimer = setInterval(() => {
      this.requestContexts.evictExpired(ttlMs, (id, ctx) => {
        this.handleRequestTimeout(id, ctx.requestToolName || 'unknown', ctx, 'context TTL exceeded');
      });
    }, Math.min(ttlMs, 60_000));
    if (typeof this.contextTtlTimer.unref === 'function') {
      this.contextTtlTimer.unref();
    }

    StructuredLogger.info({
      event: 'proxy_started',
      serverName: this.serverName,
      blockingMode: this.policyEngine ? this.policyEngine.getMode() : 'audit',
      authEnabled: this.authValidator ? this.authValidator.getConfig().required : false,
      circuitBreaker: this.breakerFor(this.defaultTenantId).getState(),
      tenantId: this.defaultTenantId,
      requestTimeoutMs: this.requestTimeoutMs,
    });
  }

  private breakerFor(tenantId: string = DEFAULT_TENANT_ID): ReturnType<typeof getCircuitBreaker> {
    return getCircuitBreaker(tenantId || this.defaultTenantId, this.serverName);
  }

  private spawnChild(): void {
    this.child = spawn(this.spawnCommand, this.spawnArgs, {
      env: this.spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.on('spawn', () => {
      this.restartCount = 0; // reset after successful start
    });

    this.child.on('exit', (code, signal) => {
      if (signal !== 'SIGTERM') {
        this.failAllPendingRequests(
          -32005,
          `Upstream MCP server '${this.serverName}' process exited (code=${code}, signal=${signal})`,
        );
        this.sessionAuth.clearExcept(this.mcpSessionId);
      }
      if (signal === 'SIGTERM') return; // intentional shutdown
      if (this.restartCount < this.maxRestarts) {
        this.restartCount++;
        const delay = RESTART_BACKOFF_MS[this.restartCount - 1] ?? 16000;
        Logger.warn(
          `[proxy:${this.serverName}] Child process exited (code=${code}, signal=${signal}), restarting with backoff ${delay}ms (attempt ${this.restartCount}/${this.maxRestarts})...`
        );
        setTimeout(() => this.spawnChild(), delay);
      } else {
        Logger.error(`[proxy:${this.serverName}] Child process exceeded max restarts (${this.maxRestarts}), giving up`);
        StructuredLogger.logError({
          event: 'proxy_error' as const,
          serverName: this.serverName,
          error: `Child process exceeded max restarts (${this.maxRestarts}), code=${code}, signal=${signal}`,
        });
      }
    });

    this.setupStdout();
    this.setupStderr();
  }

  get stdin(): NodeJS.WritableStream | null {
    return this.child.stdin;
  }

  private setupStdout(): void {
    const rl = createInterface({ input: this.child.stdout! });
    rl.on('line', (line: string) => {
      void this.handleStdoutLine(line);
    });

    rl.on('close', () => {
      Logger.debug(`[proxy:${this.serverName}] stdout closed`);
    });
  }

  private async handleStdoutLine(line: string): Promise<void> {
      try {
        const msg = JSON.parse(line);

        // ── Rug-pull: fingerprint tools/list on any message carrying result.tools ──
        if (msg.result?.tools && Array.isArray(msg.result.tools)) {
          if (msg.id != null) this.pendingToolsListIds.delete(msg.id);
          onToolsListObserved(this.serverName, msg.result.tools);
          applyToolFingerprintFromResult(this.rugPullState, msg.result, {
            serverName: this.serverName,
            tenantId: this.defaultTenantId,
            onMismatch: async (_ctx) => {
              void publishRugPullAlert(
                this.serverName,
                this.defaultTenantId,
                this.rugPullState.fingerprint || '',
              );
            },
          });
        }

        if (msg.id != null) {
          const reqCtx = this.requestContexts.get(msg.id);
          if (!reqCtx) {
            this.stdoutWriter.writeLine(line);
            return;
          }
          this.requestContexts.clearTimeout(msg.id);
          const proxyLatencyMs = Date.now() - reqCtx.requestStartTime;

          if (reqCtx.requestMethod === 'resources/read' || reqCtx.requestMethod === 'prompts/get') {
            const rp = applyMcpResponsePipeline({
              method: reqCtx.requestMethod,
              result: msg.result,
              sessionId: reqCtx.sessionId ?? this.mcpSessionId ?? String(msg.id),
              latencyMs: proxyLatencyMs,
            });
            if (rp.blocked) {
              const blockJson = mcpResponseBlockJson(msg.id, rp.reason ?? 'Resource/prompt blocked by Mastyf AI');
              this.responseTracker.sendJson(this.stdoutWriter, blockJson as Record<string, unknown>);
              this.requestContexts.delete(msg.id);
              return;
            }
            if (rp.result !== undefined) {
              msg.result = rp.result;
            }
            this.responseTracker.sendJson(this.stdoutWriter, msg as Record<string, unknown>);
            this.requestContexts.delete(msg.id);
            return;
          }

          const reqMsg = {
            params: { name: reqCtx.requestToolName, arguments: reqCtx.requestArguments },
          };
          const model = resolveModelId(reqCtx.requestModel) || resolveModelIdForServer(this.serverName, this.spawnEnv, this.spawnArgs);
          const counts = this.tokenCounter.countProxyCall({
            requestText: reqCtx.requestRaw || JSON.stringify(reqMsg),
            responseText: line,
            model,
            requestPayload: reqMsg,
            responsePayload: msg,
          });
          const record: ProxyCallRecord = {
            serverName: this.serverName,
            toolName: reqCtx.requestToolName || 'unknown',
            requestTokens: counts.requestTokens,
            responseTokens: counts.responseTokens,
            totalTokens: counts.totalTokens,
            durationMs: proxyLatencyMs,
            timestamp: new Date().toISOString(),
            tokenSource: counts.tokenSource,
            model,
            tenantId: reqCtx.tenantId || this.defaultTenantId,
            spendReservationId: reqCtx.spendReservationId,
          };

          if (msg?.result && !isResponseScanSkipped()) {
            const inspected = await sharedInspectToolResponse({
              response: msg as Record<string, unknown>,
              toolName: reqCtx.requestToolName || 'unknown',
              serverName: this.serverName,
              requestId: msg.id as string | number,
              tenantId: reqCtx.tenantId,
              policyEngine: this.policyEngine,
              transportLabel: 'stdio-proxy',
              toolArguments: reqCtx.requestArguments,
            });
            const policyMode = this.policyEngine?.getMode() ?? 'audit';
            line = JSON.stringify(msg);

            if (inspected.redacted || inspected.blocked) {
              recordSensitiveResponseAccess(
                flowSessionKey({
                  serverName: this.serverName,
                  toolName: reqCtx.requestToolName || 'unknown',
                  requestId: String(msg.id),
                  requestTokens: reqCtx.requestTokens,
                  timestamp: new Date().toISOString(),
                  tenantId: reqCtx.tenantId,
                  agentIdentity: reqCtx.agentIdentity,
                } as CallContext),
                reqCtx.requestToolName || 'unknown',
              );
            }

            if (inspected.blocked && policyMode === 'block') {
              persistCallRecord(
                this.db,
                {
                  ...record,
                  responseTokens: 0,
                  totalTokens: record.requestTokens,
                  blocked: true,
                  blockRule: 'response-gate',
                  blockReason:
                    (inspected.blockResponse as { error?: { message?: string } } | undefined)?.error
                      ?.message || 'Blocked by response gate',
                },
                reqMsg,
                this.spawnEnv,
                this.spawnArgs,
              ).catch(() => {});
              Metrics.recordProxyBlock(
                {
                  server_name: this.serverName,
                  block_reason: 'response-gate',
                  rule: 'response-gate',
                  tenant_id: reqCtx.tenantId,
                },
                'response_gate',
              );
              Metrics.requestsTotal.inc(
                Metrics.withTenantMetricLabels(
                  { server_name: this.serverName, decision: 'block', authn_success: 'true' },
                  reqCtx.tenantId,
                ),
              );
              const errMsg =
                (inspected.blockResponse as { error?: { message?: string } } | undefined)?.error
                  ?.message || 'Blocked by response gate';
              this.sendError(msg.id, -32002, errMsg);
              this.requestContexts.delete(msg.id);
              this.currentRequestId = null;
              return;
            }
          }

          persistCallRecord(this.db, record, reqMsg, this.spawnEnv, this.spawnArgs).catch((err) =>
            Logger.debug(`Proxy: failed to store call record: ${err?.message}`)
          );
          void agenticRecordCompletedToolCall({
            serverName: this.serverName,
            sessionId: String(msg.id),
            toolName: reqCtx.requestToolName || 'unknown',
            args: reqCtx.requestArguments,
            latencyMs: proxyLatencyMs,
            blocked: false,
            responseSize: line.length,
          });
          const tenantBreaker = this.breakerFor(reqCtx.tenantId || this.defaultTenantId);
          tenantBreaker.recordSuccess();
          Metrics.circuitBreakerState.set({ server_name: this.serverName }, tenantBreaker.getState() === 'CLOSED' ? 0 : tenantBreaker.getState() === 'OPEN' ? 1 : 2);
          Metrics.proxyLatencyMs.observe(
            Metrics.withTenantMetricLabels({ server_name: this.serverName }, reqCtx.tenantId),
            proxyLatencyMs,
          );
          Metrics.requestsTotal.inc(
            Metrics.withTenantMetricLabels(
              { server_name: this.serverName, decision: 'pass', authn_success: 'true' },
              reqCtx.tenantId,
            ),
          );
          if (this.sessionCache) Metrics.activeSessions.set(this.sessionCache.size);

          StructuredLogger.info({
            event: 'response_sent',
            serverName: this.serverName,
            requestId: msg.id,
            toolName: reqCtx.requestToolName,
            proxyLatencyMs,
          });

          if (reqCtx.rotatedSessionToken && msg.result && typeof msg.result === 'object') {
            const result = msg.result as Record<string, unknown>;
            const meta = (result._meta as Record<string, unknown> | undefined) ?? {};
            meta.sessionToken = reqCtx.rotatedSessionToken;
            result._meta = meta;
            line = JSON.stringify(msg);
          }

          this.requestContexts.delete(msg.id);
          this.currentRequestId = null;
          this.responseTracker.markResponded(msg.id);
        }
        this.stdoutWriter.writeLine(line);
      } catch (parseErr: unknown) {
        const orphanId = this.resolveOrphanResponseId();
        if (orphanId != null) {
          this.sendError(
            orphanId,
            -32700,
            `Mastyf AI: malformed JSON from upstream MCP server`,
          );
          this.requestContexts.delete(orphanId);
          this.currentRequestId = null;
        } else {
          this.stdoutWriter.writeLine(line);
        }
        Logger.debug(
          `[proxy:${this.serverName}] Non-JSON stdout line: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
        );
      }
  }

  private setupStderr(): void {
    this.child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
    });
  }

  private sendError(id: string | number, code: number, message: string, data?: Record<string, unknown>): void {
    this.requestContexts.clearTimeout(id);
    this.responseTracker.sendError(this.stdoutWriter, id, code, message, data);
  }

  private failAllPendingRequests(code: number, message: string): void {
    this.requestContexts.drain((id, ctx) => {
      this.sendError(id, code, message, { rule: 'upstream-unavailable' });
      this.requestContexts.delete(id, false);
      releaseSpendReservation(ctx);
    });
    this.requestContexts.clearAllTimeouts();
    this.currentRequestId = null;
  }

  private resolveOrphanResponseId(): string | number | null {
    if (this.requestContexts.size === 1) {
      return this.requestContexts.ids()[0] ?? null;
    }
    return this.currentRequestId;
  }

  private handleRequestTimeout(
    requestId: string | number,
    toolName: string,
    reqCtx: ProxyRequestContext,
    reason: string,
  ): void {
    if (!this.requestContexts.get(requestId)) return;
    const durationMs = Date.now() - (reqCtx.requestStartTime ?? Date.now());
    this.recordDeniedCall(toolName, reqCtx.requestTokens ?? 0, durationMs, 'request-timeout', reason, undefined, reqCtx.tenantId);
    this.breakerFor(reqCtx.tenantId || this.defaultTenantId).recordFailure();
    Metrics.recordProxyBlock(
      {
        server_name: this.serverName,
        block_reason: 'request_timeout',
        rule: 'request-timeout',
        tenant_id: reqCtx.tenantId,
      },
      'timeout',
    );
    Metrics.requestsTotal.inc({
      server_name: this.serverName,
      decision: 'block',
      authn_success: 'true',
    });
    StructuredLogger.info({
      event: 'request_denied',
      serverName: this.serverName,
      toolName,
      requestId: String(requestId),
      blockReason: 'request_timeout',
      proxyLatencyMs: durationMs,
    });
    this.sendError(requestId, -32006, `Mastyf AI: ${reason}`, { rule: 'request-timeout' });
    this.requestContexts.delete(requestId);
    if (this.currentRequestId === requestId) {
      this.currentRequestId = null;
    }
  }

  private armRequestTimeout(requestId: string | number, toolName: string): void {
    const timeoutMs = resolveToolTimeoutMs(toolName, this.requestTimeoutMs);
    this.requestContexts.armTimeout(requestId, timeoutMs, (id, ctx) => {
      const reason = `Upstream request timed out after ${timeoutMs}ms`;
      this.handleRequestTimeout(id, toolName, ctx, reason);
    });
  }

  private clearRequestTimeout(requestId?: string | number): void {
    if (requestId != null) {
      this.requestContexts.clearTimeout(requestId);
      return;
    }
    this.requestContexts.clearAllTimeouts();
  }

  private recordDeniedCall(
    toolName: string,
    requestTokens: number,
    durationMs: number,
    blockRule: string,
    blockReason: string,
    requestArguments?: Record<string, unknown>,
    tenantId?: string,
    requestId?: string | number,
  ): void {
    const tid = tenantId || this.defaultTenantId;
    const snippets = redactArgSnippets(requestArguments);
    const record: ProxyCallRecord = {
      serverName: this.serverName,
      toolName,
      requestTokens,
      responseTokens: 0,
      totalTokens: requestTokens,
      durationMs,
      timestamp: new Date().toISOString(),
      blocked: true,
      blockRule,
      blockReason,
      argumentSnippet: snippets.length > 0 ? snippets.join(' | ').slice(0, 2048) : undefined,
      tenantId: tid,
    };
    StructuredLogger.logBlocked({
      event: 'tool_blocked',
      requestId: String(requestId ?? 'stdio-denied'),
      serverName: this.serverName,
      toolName,
      reason: blockReason,
      rule: blockRule,
    });
    persistCallRecord(this.db, record, undefined, this.spawnEnv, this.spawnArgs).catch((err) =>
      Logger.debug(`Proxy: failed to store denied call record: ${err?.message}`)
    );
    const learningEvent = {
      block_rule: blockRule,
      block_reason: blockReason,
      toolName,
      serverName: this.serverName,
      argsFingerprint: fingerprintArgs(requestArguments),
      argSnippets: redactArgSnippets(requestArguments),
      arguments: redactArguments(requestArguments),
      tenantId: tid,
    };
    const learningOpts = { db: this.db as HistoryDatabase };
    setImmediate(() => recordBlockLearningEvent(learningEvent, learningOpts));
    agenticRecordDeniedToolCall({
      serverName: this.serverName,
      sessionId: requestId != null ? String(requestId) : `denied-${Date.now()}`,
      toolName,
      args: requestArguments,
      latencyMs: durationMs,
      blockRule,
      blockReason,
    });
  }

  /**
   * Called when the AI client writes a request to be proxied.
   * Pipeline: Payload guard → Auth → Circuit Breaker → Policy + RBAC → Forward.
   */
  async handleClientInput(raw: string): Promise<void> {
    let requestKey: string | undefined;
    try {
      const peek = JSON.parse(raw) as { id?: string | number; method?: string };
      if (peek.method === 'tools/call' && peek.id != null) requestKey = String(peek.id);
    } catch {
      /* non-JSON handled in processClientInput */
    }
    return this.clientInputQueue.enqueue(requestKey, () =>
      withProxyRequestVault(raw, undefined, () => {
        let traceHeaders: Record<string, string | string[] | undefined> | undefined;
        try {
          const peek = JSON.parse(raw) as { params?: { _meta?: Record<string, unknown> } };
          const tp = peek.params?._meta?.traceparent;
          if (typeof tp === 'string') traceHeaders = { traceparent: tp };
        } catch {
          // non-JSON handled in processClientInput
        }
        return runWithExtractedTraceAsync(traceHeaders, () => this.processClientInput(raw));
      }),
    );
  }

  private async processClientInput(inboundRaw: string): Promise<void> {
    let raw = inboundRaw;
    // ── Payload size guard ──────────────────────────────────
    const rawGuard = checkRawPayloadSize(raw);
    if (!rawGuard.ok) {
      Logger.warn(`[Proxy] Oversized payload rejected: ${rawGuard.reason}`);
      try {
        const msg = JSON.parse(raw);
        if (hasJsonRpcId(msg.id)) {
          this.sendError(msg.id, -32001, 'Payload exceeds MCP Mastyf AI size limit');
        }
      } catch {
        // Non-JSON oversize — silently drop
      }
      return;
    }

    const requestId = randomUUID();
    const proxyStartTime = Date.now();

    try {
      const msg = JSON.parse(raw);

      let initAuth: string | undefined;
      if (msg.method === 'initialize') {
        initAuth = OAuthValidator.extractAuthFromMcpMessage(msg);
      }

      const stickySessionAuth = process.env['MASTYF_AI_STICKY_SESSION_AUTH'] === 'true';
      const lifecycleAuthRequired = Boolean(this.authValidator?.getConfig().required);
      const pre = runMcpPrePipeline({
        msg: msg as Record<string, unknown>,
        serverName: this.serverName,
        authenticated: lifecycleAuthRequired
          ? Boolean(initAuth ?? this.sessionAuth.getAuthHeader(this.mcpSessionId, undefined, stickySessionAuth))
          : true,
        fallbackSessionKey: this.mcpSessionId ?? undefined,
      });
      if (pre.blocked && hasJsonRpcId(msg.id)) {
        const err = pre.response.error as { code?: number; message?: string } | undefined;
        this.sendError(msg.id, err?.code ?? -32001, err?.message ?? 'MCP pre-pipeline blocked request');
        return;
      }
      if (!pre.blocked) {
        const previousSessionId = this.mcpSessionId;
        this.mcpSessionId = pre.session.sessionId;
        this.mcpAgentId = pre.session.agentId;
        this.sessionAuth.onSessionChange(previousSessionId, pre.session.sessionId);
        if (msg.method === 'initialize' && initAuth) {
          this.sessionAuth.setForSession(pre.session.sessionId, initAuth);
        }
      }

      if (
        !pre.blocked
        && pre.trackResponse
        && hasJsonRpcId(msg.id)
      ) {
        this.requestContexts.set(msg.id, {
          requestStartTime: proxyStartTime,
          createdAt: proxyStartTime,
          requestToolName: String(pre.requestMethod ?? msg.method),
          requestMethod: pre.requestMethod,
          requestTokens: 0,
          requestRaw: raw,
          sessionId: pre.session.sessionId,
          agentId: pre.session.agentId,
          tenantId: this.defaultTenantId,
        });
      }

      if (msg.method === 'tools/list' && msg.id != null) {
        this.pendingToolsListIds.add(msg.id);
      }

      if (msg.method === 'tools/call' && hasJsonRpcId(msg.id)) {
        const maxInflightEarly = proxyMaxInflight();
        if (isProxyInflightExceeded(this.requestContexts.size)) {
          Metrics.proxyInflightRejectedTotal.inc(
            Metrics.withTenantMetricLabels(
              { server_name: this.serverName },
              this.defaultTenantId,
            ),
          );
          this.sendError(
            msg.id,
            -32005,
            `Mastyf AI: proxy overloaded (${this.requestContexts.size}/${maxInflightEarly} in flight)`,
            { rule: 'proxy-max-inflight' },
          );
          Metrics.requestsTotal.inc({
            server_name: this.serverName,
            decision: 'block',
            authn_success: 'false',
          });
          return;
        }

        const meta = msg.params?._meta as Record<string, unknown> | undefined;
        const tenantForRug = resolveProxyTenantId({
          meta,
          authenticated: false,
          jwtTenantId: this.defaultTenantId,
        });
        if (
          this.rugPullState.blocked
          || (await isClusterRugPullActive(this.serverName, tenantForRug))
        ) {
          const toolName = msg.params?.name || 'unknown';
          this.recordDeniedCall(
            toolName,
            0,
            Date.now() - proxyStartTime,
            'tool-fingerprint-mismatch',
            'Tool definitions changed mid-session (rug-pull detected)',
          );
          this.sendError(msg.id, -32001, 'Blocked by MCP Mastyf AI policy: tool definitions changed mid-session (rug-pull)', {
            rule: 'tool-fingerprint-mismatch',
            policy: this.policyEngine?.getMode() ?? 'block',
          });
          Metrics.recordProxyBlock(
            {
              server_name: this.serverName,
              block_reason: 'rug_pull',
              rule: 'tool-fingerprint-mismatch',
              tenant_id: this.defaultTenantId,
            },
            'rug_pull',
          );
          return;
        }

        this.currentRequestId = msg.id;
        const toolName = msg.params?.name || 'unknown';
        let requestTenantId = this.defaultTenantId;
        try {
          requestTenantId = resolveTenantContext({ meta: msg.params?._meta }).tenantId;
        } catch (err) {
          if (err instanceof InvalidTenantIdError) {
            this.sendError(msg.id, -32602, `Invalid tenant id: ${err.message}`);
            return;
          }
          throw err;
        }
        const requestModel =
          extractModelFromPayload(msg) || resolveModelId();
        const reqEstimate =
          this.tokenCounter.countWithProvider(raw, requestModel)?.tokens ??
          this.tokenCounter.count(raw);
        const imageTokens = countImageTokensInPayload(msg.params?.arguments);
        const audioTokens = countAudioTokensInPayload(msg.params?.arguments);
        const requestTokens = reqEstimate + imageTokens + audioTokens;
        let requestArguments = msg.params?.arguments as Record<string, unknown> | undefined;

        if (requestArguments !== undefined) {
          const { runToolCallPreForwardGuard, toolCallGuardBlockResponse } = await import(
            './tool-call-pre-guard.js'
          );
          const preGuard = await runToolCallPreForwardGuard(
            this.serverName,
            toolName,
            requestArguments,
            requestId,
            {
              agentId: this.mcpAgentId ?? undefined,
              meta,
              mcpSessionId: this.mcpSessionId ?? undefined,
            },
          );
          if (preGuard.blocked) {
            this.recordDeniedCall(
              toolName,
              requestTokens,
              Date.now() - proxyStartTime,
              'payload_or_agentic',
              preGuard.message || 'Pre-forward guard blocked',
              requestArguments,
              requestTenantId,
              msg.id,
            );
            const blockResp = toolCallGuardBlockResponse(msg.id, preGuard);
            this.responseTracker.sendJson(this.stdoutWriter, blockResp as Record<string, unknown>);
            return;
          }
          if (preGuard.arguments) {
            requestArguments = preGuard.arguments;
            if (msg.params) msg.params.arguments = requestArguments;
            raw = JSON.stringify(msg);
          }
        }

        if (requestArguments !== undefined) {
          const expandedGuard = checkExpandedPayload(requestArguments);
          if (!expandedGuard.ok) {
            this.recordDeniedCall(
              toolName,
              requestTokens,
              Date.now() - proxyStartTime,
              'payload-expanded-limit',
              expandedGuard.reason,
              requestArguments,
              requestTenantId,
              msg.id,
            );
            this.sendError(msg.id, -32001, `Blocked by Mastyf AI: ${expandedGuard.reason}`, {
              rule: 'payload-expanded-limit',
            });
            return;
          }
        }

        // ── P0 Week 3: DLP on tool call arguments (runtime exfiltration) ──
        if (requestArguments) {
          const multimodalFindings = scanMultimodalContent(requestArguments);
          if (multimodalFindings.length > 0 && this.policyEngine?.getMode() === 'block') {
            const mmReason = multimodalFindings.map((f) => f.description).slice(0, 3).join('; ');
            this.recordDeniedCall(toolName, requestTokens, Date.now() - proxyStartTime, 'multimodal-injection', mmReason);
            this.sendError(msg.id, -32001, `Blocked by MCP Mastyf AI policy: ${mmReason}`, {
              rule: 'multimodal-injection',
              policy: 'block',
            });
            return;
          }
          const argString = JSON.stringify(requestArguments);
          const secretFindings = scanForSecrets(argString, `proxy:${this.serverName}:${toolName}`);
          if (secretFindings.length > 0) {
            const secretSummary = secretFindings.map(f => f.type).slice(0, 5).join(', ');
            Logger.warn(
              `[proxy:${this.serverName}] 🔑 SECRET DETECTED in arguments of '${toolName}': ${secretSummary}` +
              (secretFindings.length > 5 ? `... (+${secretFindings.length - 5} more)` : '')
            );
            StructuredLogger.info({
              event: 'secret_in_args_detected' as any,
              serverName: this.serverName,
              toolName,
              secretCount: secretFindings.length,
              secrets: secretFindings.map(f => ({ type: f.type, redacted: f.redacted })),
              requestId,
            });

            if (
              isProxyEntropyCheckEnabled(this.policyEngine?.getMode()) &&
              this.policyEngine?.getMode() === 'block'
            ) {
              const entropyFindings = scanArgumentEntropy(argString);
              if (entropyFindings.length > 0) {
                const entropyReason = `High-entropy encoded payload in '${toolName}' arguments (${entropyFindings[0].kind}, entropy=${entropyFindings[0].entropy.toFixed(2)})`;
                this.recordDeniedCall(toolName, requestTokens, Date.now() - proxyStartTime, 'arg-entropy', entropyReason);
                this.sendError(msg.id, -32001, `Blocked by MCP Mastyf AI policy: ${entropyReason}`, {
                  rule: 'arg-entropy',
                  policy: 'block',
                });
                return;
              }
            }

            // DLP block in blocking mode — stop exfiltration before it reaches the server
            if (this.policyEngine?.getMode() === 'block') {
              const dlpReason = `${secretFindings.length} potential secret(s) detected in '${toolName}' arguments. Detected: ${secretSummary}`;
              this.recordDeniedCall(toolName, requestTokens, Date.now() - proxyStartTime, 'secret-scan', dlpReason);
              this.sendError(
                msg.id, -32001,
                `Blocked by MCP Mastyf AI policy: ${dlpReason}`,
                { rule: 'secret-scan', policy: 'block' },
              );
              StructuredLogger.info({
                event: 'request_denied',
                requestId,
                serverName: this.serverName,
                toolName,
                blockReason: `dlp:${secretFindings.length}_secrets_in_args`,
                proxyLatencyMs: Date.now() - proxyStartTime,
              });
              Metrics.recordProxyBlock(
                {
                  server_name: this.serverName,
                  block_reason: 'dlp_secrets_in_args',
                  rule: 'secret-scan',
                  tenant_id: requestTenantId,
                },
                'dlp',
              );
              Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'block', authn_success: 'true' });
              return;
            }
          }
        }

        let agentIdentity: AgentIdentity | undefined;
        let authnSuccess = false;
        let pendingRotatedSessionToken: string | undefined;

        // ── OAuth 2.1 JWT validation ────────────────────────
        if (this.authValidator) {
          const msgAuth = OAuthValidator.extractAuthFromMcpMessage(msg);
          const authHeader = this.sessionAuth.getAuthHeader(
            this.mcpSessionId,
            msgAuth,
            stickySessionAuth,
          );

          const token = OAuthValidator.extractToken(authHeader);

          if (!token) {
            if (this.authValidator.getConfig().required) {
              StructuredLogger.info({
                event: 'auth_required',
                requestId,
                serverName: this.serverName,
                toolName,
                authnSuccess: false,
              });
              this.sendError(msg.id, -32002, 'Authentication required. Provide a valid Bearer token in the Authorization header.');
              return;
            }
          } else {
            let result: AuthValidationResult = await this.authValidator.validate(token);
            if (!result.valid && this.sessionCache) {
              const sessionResult = await validateSessionToken(this.sessionCache, token, requestTenantId);
              if (sessionResult) {
                result = { valid: true, identity: sessionResult.identity };
                if (sessionResult.rotatedToken) {
                  pendingRotatedSessionToken = sessionResult.rotatedToken;
                }
              }
            }
            authnSuccess = result.valid;
            if (result.identity) agentIdentity = result.identity;

            if (!result.valid) {
              StructuredLogger.logError({
                event: 'oidc_auth_error',
                serverName: this.serverName,
                requestId,
                error: `JWT validation failed: ${result.error}`,
              });

              if (this.authValidator.getConfig().required) {
                this.sendError(msg.id, -32003, `Authentication failed: ${result.error}`);
                return;
              }
            } else {
              try {
                requestTenantId = resolveProxyTenantId({
                  meta: msg.params?._meta,
                  jwtTenantId: agentIdentity?.tenantId,
                  authenticated: true,
                });
                // tenant applied when context is registered after auth gates
              } catch (err) {
                if (err instanceof JwtTenantRequiredError || err instanceof InvalidTenantIdError) {
                  this.sendError(msg.id, -32003, err.message);
                  return;
                }
                throw err;
              }

              const dpopProof = extractDpopProof({
                metaAuth: msg.params?._meta?.auth as Record<string, unknown> | undefined,
                messageDpop: typeof msg.DPoP === 'string' ? msg.DPoP : undefined,
              });
              const dpopUri = `mcp://${this.serverName}/tools/call`;
              const dpopCheck = await validateRequiredDpop(
                dpopProof,
                'POST',
                dpopUri,
                token,
                requestTenantId,
                this.policyEngine?.getMode(),
              );
              if (!dpopCheck.valid) {
                this.sendError(msg.id, -32004, dpopCheck.error || 'DPoP validation failed');
                return;
              }

              if (this.sessionCache && result.identity) {
                const session = this.sessionCache.createSession(result.identity, undefined, requestTenantId);
                StructuredLogger.info({
                  event: 'auth_success',
                  requestId,
                  serverName: this.serverName,
                  toolName,
                  agent: result.identity.sub,
                  clientId: result.identity.clientId,
                  sessionToken: session.token,
                  sessionExpiry: new Date(session.expiresAt).toISOString(),
                  authnSuccess: true,
                });
              } else {
                StructuredLogger.info({
                  event: 'auth_success',
                  requestId,
                  serverName: this.serverName,
                  toolName,
                  agent: result.identity?.sub,
                  clientId: result.identity?.clientId,
                  authnSuccess: true,
                });
              }
            }
          }
        }

        // ── Circuit breaker check ───────────────────────────
        const tenantBreaker = this.breakerFor(requestTenantId);
        if (!tenantBreaker.allowRequest()) {
          StructuredLogger.info({
            event: 'circuit_open',
            requestId,
            serverName: this.serverName,
            toolName,
            tenantId: requestTenantId,
            state: tenantBreaker.getState(),
          });
          this.sendError(msg.id, -32005, `Upstream MCP server '${this.serverName}' unavailable — circuit breaker open`);
          tenantBreaker.recordFailure();
          return;
        }

        // ── Defense Fabric (lifecycle + policy + spend + semantic) ──
        let authzAllowed = true;
        let blockReason: string | undefined;
        let spendReservationId: string | undefined;

        const engine =
          this.tenantPolicyRegistry?.getEngine(requestTenantId) ?? this.policyEngine;

        if (engine) {
          const tenantId = requestTenantId;
          const idempotencyKey = idempotencyKeyFromRequest(
            msg.params?._meta as Record<string, unknown> | undefined,
          );

          const defense = await evaluateToolCallDefense(
            {
              serverName: this.serverName,
              toolName,
              arguments: requestArguments,
              requestId,
              requestTokens,
              tenantId,
              agentIdentity,
              idempotencyKey,
            },
            {
              policyEngine: engine,
              db: this.db,
              rugPullState: this.rugPullState,
              evaluatePolicy: (ctx) => this.evaluatePolicyPinned(engine, ctx),
            },
          );

          await waitProxyTimingNormalize(proxyStartTime);

          if (!defense.allowed) {
            authzAllowed = false;
            blockReason = `${defense.phase}:${defense.rule}:${defense.reason}`;
            this.recordDeniedCall(
              toolName,
              requestTokens,
              Date.now() - proxyStartTime,
              defense.rule,
              defense.reason,
              requestArguments,
              requestTenantId,
            );
            this.sendError(msg.id, -32001, `Blocked by MCP Mastyf AI: ${defense.reason}`, {
              rule: defense.rule,
              policy: engine.getMode(),
            });
            return;
          }

          if (defense.allowed) {
            requestArguments = defense.arguments ?? requestArguments;
            spendReservationId = defense.spendReservationId;
            ingestPolicyDecision({
              requestId,
              serverName: this.serverName,
              toolName,
              action: defense.decision.action,
              rule: defense.decision.rule,
              reason: defense.decision.reason,
              timestamp: defense.context.timestamp,
              requestTokens,
            });
            StructuredLogger.logPolicyDecision({
              event: 'policy_decision',
              requestId,
              serverName: this.serverName,
              toolName,
              decision: defense.decision,
              context: defense.context,
            });
          }
        }


        this.responseTracker.clearResponded(msg.id);
        this.requestContexts.set(msg.id, {
          requestStartTime: proxyStartTime,
          createdAt: proxyStartTime,
          requestToolName: toolName,
          requestTokens,
          requestRaw: raw,
          requestModel,
          requestArguments,
          tenantId: requestTenantId,
          agentIdentity,
          rotatedSessionToken: pendingRotatedSessionToken,
          spendReservationId,
        });

        // ── Log successful forwarding ───────────────────────
        StructuredLogger.info({
          event: 'request_forwarded',
          requestId,
          serverName: this.serverName,
          toolName,
          authnSuccess,
          authzAllowed,
          proxyLatencyMs: Date.now() - proxyStartTime,
          agent: agentIdentity?.sub,
        });
      }
    } catch {
      // Non-JSON input — forward as-is
    }

    try {
      const fwd = JSON.parse(raw);
      if (fwd.method === 'tools/call' && fwd.id) {
        const ctx = this.requestContexts.get(fwd.id);
        if (ctx) {
          this.armRequestTimeout(fwd.id, ctx.requestToolName || 'unknown');
        }
        await withMcpToolCallSpan({
          serverName: this.serverName,
          toolName: ctx?.requestToolName || (fwd.params as { name?: string } | undefined)?.name || 'unknown',
          tenantId: ctx?.tenantId,
          transport: 'stdio',
        }, async () => {
          this.child.stdin?.write(raw + '\n');
        });
        return;
      }
    } catch {
      // non-JSON — no timeout arm
    }

    this.child.stdin?.write(raw + '\n');
  }

  /** Atomically swap the active policy engine (used by hot-reload) */
  setPolicyEngine(engine: PolicyEngine): void {
    if (this.policyEvalInflight > 0) {
      this.pendingPolicyEngine = engine;
      Logger.info(`[proxy:${this.serverName}] Policy hot-swap deferred — ${this.policyEvalInflight} eval(s) in flight`);
      return;
    }
    this.policyEngine = engine;
    Logger.info(`[proxy:${this.serverName}] Policy engine hot-swapped — mode: ${engine.getMode()}`);
  }

  private async evaluatePolicyPinned(
    engine: PolicyEngine,
    context: import('../policy/policy-types.js').CallContext,
  ): Promise<import('../policy/policy-types.js').PolicyDecision> {
    this.policyEvalInflight += 1;
    const pinned = engine;
    try {
      return await pinned.evaluateAsync(context);
    } finally {
      this.policyEvalInflight -= 1;
      if (this.policyEvalInflight === 0 && this.pendingPolicyEngine) {
        this.policyEngine = this.pendingPolicyEngine;
        this.pendingPolicyEngine = null;
        Logger.info(`[proxy:${this.serverName}] Deferred policy swap applied`);
      }
    }
  }

  kill(): void {
    if (this.contextTtlTimer) {
      clearInterval(this.contextTtlTimer);
      this.contextTtlTimer = null;
    }
    if (this.stopMemoryMonitor) {
      this.stopMemoryMonitor();
      this.stopMemoryMonitor = null;
    }
    this.failAllPendingRequests(-32005, `Proxy for '${this.serverName}' is shutting down`);
    try {
      this.child.kill('SIGTERM');
    } catch {
      // Already dead
    }
  }
}
