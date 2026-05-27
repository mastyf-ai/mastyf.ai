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
import { StructuredLogger } from '../utils/structured-logger.js';
import { OAuthValidator } from '../auth/oauth.js';
import { AuthValidationResult, AgentIdentity } from '../auth/auth-types.js';
import { createSessionCache, validateSessionToken, type GuardianSessionCache } from '../auth/session-factory.js';
import { getCircuitBreaker } from '../utils/circuit-breaker-registry.js';
import { ProxyRequestContextStore } from './proxy-request-context.js';
import { resolveTenantContext, DEFAULT_TENANT_ID, InvalidTenantIdError } from '../tenant/resolve-tenant.js';
import { JwtTenantRequiredError, resolveProxyTenantId } from '../tenant/jwt-tenant-binding.js';
import { idempotencyKeyFromRequest } from '../policy/idempotency-store.js';
import { RequestIdLock } from '../utils/request-id-lock.js';
import { scanMultimodalContent } from '../scanners/multimodal-content-scanner.js';
import type { TenantPolicyRegistry } from '../policy/tenant-policy-registry.js';
import {
  isSemanticLlmConfigured,
  isSemanticStrictMode,
  reportSemanticDegradation,
} from '../utils/semantic-layer.js';
import { isSemanticAsyncEnabled } from '../ai/async-semantic-audit.js';
import { findingsToMessages, isResponseScanSkipped } from '../utils/streaming-inspector.js';
import { gateToolResponseText } from '../utils/response-security-gate.js';
import { injectRedactionMeta } from '../utils/redaction-meta.js';
import {
  flowSessionKey,
  recordSessionToolCall,
} from '../policy/session-flow-guard.js';
import { recordSensitiveResponseAccess } from '../policy/session-flow-store.js';
import { scanForSecrets } from '../scanners/secret-scanner.js';
import { isProxyEntropyCheckEnabled, scanArgumentEntropy } from '../utils/arg-entropy.js';
import * as Metrics from '../utils/metrics.js';
import { alertPolicyBlock } from '../alerting/webhook-alerter.js';
import { evaluateCveGate } from '../utils/cve-gate.js';
import { persistCallRecord } from '../utils/call-record-cost.js';
import {
  recordBlockLearningEvent,
  fingerprintArgs,
  redactArgSnippets,
  redactArguments,
  ingestPolicyDecision,
} from '../ai/block-learning.js';
import { buildSemanticAuditJob, enqueueSemanticAudit } from '../ai/async-semantic-audit.js';
import { isSyncSemanticRequestEnabled } from '../ai/sync-semantic-request.js';
import { publishRugPullAlert, isClusterRugPullActive } from './rug-pull-cluster.js';
import {
  applyToolFingerprintFromResult,
  type ToolFingerprintState,
} from './tool-fingerprint.js';
import { isProxyInflightExceeded, proxyMaxInflight } from './proxy-inflight.js';
import { runSyncSemanticRequestGate } from './proxy-post-policy-gates.js';
import { resolveToolTimeoutMs } from '../utils/tool-timeout.js';
import type { HistoryDatabase } from '../database/history-db.js';
import { resolveModelId, resolveModelIdForServer } from '../config/llm-config.js';
import { extractDpopProof, validateRequiredDpop } from '../auth/dpop-enforcement.js';
import { startMemoryMonitor } from '../utils/memory-monitor.js';

const MAX_PAYLOAD_BYTES = parseInt(
  process.env['MCP_GUARDIAN_MAX_PAYLOAD_BYTES'] ?? '10485760', // 10 MB default
);

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
  private serverName: string;
  private defaultTenantId: string;
  private policyEngine: PolicyEngine | null;
  private tenantPolicyRegistry: TenantPolicyRegistry | null;
  private authValidator: OAuthValidator | null;
  private sessionCache: GuardianSessionCache | null;
  private readonly clientInputQueue = new RequestIdLock();
  private stopMemoryMonitor: (() => void) | null = null;

  /** OWASP MCP03 rug-pull fingerprint state (tools/list). */
  private rugPullState: ToolFingerprintState = { fingerprint: null, blocked: false };
  /** Pending tools/list JSON-RPC ids awaiting correlated responses. */
  private pendingToolsListIds = new Set<string | number>();
  private pendingRequestTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bearer token captured from initialize / env for the session (stdio OAuth). */
  private sessionAuthHeader: string | undefined;

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
      'MCP_GUARDIAN_MAX_PAYLOAD_BYTES',
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
    if (process.env['GUARDIAN_MEMORY_MONITOR'] !== 'false') {
      this.stopMemoryMonitor = startMemoryMonitor({ label: this.serverName });
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
            process.stdout.write(line + '\n');
            return;
          }
          this.clearRequestTimeout();
          const proxyLatencyMs = Date.now() - reqCtx.requestStartTime;
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
          };
          persistCallRecord(this.db, record, reqMsg, this.spawnEnv, this.spawnArgs).catch((err) =>
            Logger.debug(`Proxy: failed to store call record: ${err?.message}`)
          );
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

          if (msg?.result && !isResponseScanSkipped()) {
            const responseText = JSON.stringify(msg.result);
            const gate = await gateToolResponseText({
              responseText,
              toolName: reqCtx.requestToolName || 'unknown',
              serverName: this.serverName,
              policy: this.policyEngine,
              requestId: msg.id,
              tenantId: reqCtx.tenantId,
            });
            const inspect = gate.inspect;
            const policyMode = this.policyEngine?.getMode() ?? 'audit';

            if (inspect && !inspect.clean) {
              const allMessages = findingsToMessages(inspect.findings);
              const hasCritical = inspect.hasCritical;
              const hasHigh = inspect.hasHigh;
              Logger.warn(
                `[proxy:${this.serverName}] Suspicious response from '${reqCtx.requestToolName}': ${allMessages.slice(0, 5).join('; ')}` +
                (allMessages.length > 5 ? `... (+${allMessages.length - 5} more)` : '')
              );
              StructuredLogger.info({
                event: 'response_flagged',
                serverName: this.serverName,
                toolName: reqCtx.requestToolName,
                detections: allMessages,
                criticalCount: inspect.findings.filter((f) => f.severity === 'critical').length,
                highCount: inspect.findings.filter((f) => f.severity === 'high').length,
                blocked: gate.outcome.action === 'block',
                requestId: msg.id,
              });
              Metrics.injectionDetectedTotal?.inc({
                server_name: this.serverName,
                severity: hasCritical ? 'critical' : 'high',
              });
              if (inspect.hasCritical || inspect.hasHigh) {
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
            }

            if (gate.outcome.action === 'redact') {
              try {
                const parsed = JSON.parse(gate.outcome.body) as unknown;
                msg.result = injectRedactionMeta(parsed, gate.outcome.redactionReasons);
                line = JSON.stringify(msg);
              } catch {
                /* keep upstream */
              }
            }

            if (gate.outcome.action === 'block' && policyMode === 'block') {
              const blockedRecord: ProxyCallRecord = {
                serverName: this.serverName,
                toolName: reqCtx.requestToolName || 'unknown',
                requestTokens: reqCtx.requestTokens,
                responseTokens: 0,
                totalTokens: reqCtx.requestTokens,
                durationMs: Date.now() - reqCtx.requestStartTime,
                timestamp: new Date().toISOString(),
              };
              persistCallRecord(
                this.db,
                { ...blockedRecord, blocked: true, blockRule: gate.outcome.rule },
                undefined,
                this.spawnEnv,
                this.spawnArgs,
              ).catch(() => {});
              Metrics.recordProxyBlock(
                {
                  server_name: this.serverName,
                  block_reason: gate.outcome.rule,
                  rule: gate.outcome.rule,
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
              this.sendError(msg.id, -32002, gate.outcome.message);
              this.requestContexts.delete(msg.id);
              this.currentRequestId = null;
              return;
            }
          }

          if (reqCtx.rotatedSessionToken && msg.result && typeof msg.result === 'object') {
            const result = msg.result as Record<string, unknown>;
            const meta = (result._meta as Record<string, unknown> | undefined) ?? {};
            meta.sessionToken = reqCtx.rotatedSessionToken;
            result._meta = meta;
            line = JSON.stringify(msg);
          }

          this.requestContexts.delete(msg.id);
          this.currentRequestId = null;
        }
        process.stdout.write(line + '\n');
      } catch (parseErr: unknown) {
        if (this.currentRequestId != null) {
          const rid = this.currentRequestId;
          this.sendError(
            rid,
            -32700,
            `MCP Guardian: malformed JSON from upstream MCP server`,
          );
          this.requestContexts.delete(rid);
          this.currentRequestId = null;
        } else {
          process.stdout.write(line + '\n');
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
    this.clearRequestTimeout();
    const errorResponse = JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    });
    process.stdout.write(errorResponse + '\n');
  }

  private clearRequestTimeout(): void {
    if (this.pendingRequestTimer) {
      clearTimeout(this.pendingRequestTimer);
      this.pendingRequestTimer = null;
    }
  }

  private armRequestTimeout(requestId: string | number, toolName: string): void {
    this.clearRequestTimeout();
    this.pendingRequestTimer = setTimeout(() => {
      if (this.currentRequestId !== requestId) return;
      const reqCtx = this.requestContexts.get(requestId);
      const durationMs = Date.now() - (reqCtx?.requestStartTime ?? Date.now());
      const timeoutMs = resolveToolTimeoutMs(toolName, this.requestTimeoutMs);
      const reason = `Upstream request timed out after ${timeoutMs}ms`;
      this.recordDeniedCall(toolName, reqCtx?.requestTokens ?? 0, durationMs, 'request-timeout', reason, undefined, reqCtx?.tenantId);
      this.breakerFor(reqCtx?.tenantId || this.defaultTenantId).recordFailure();
      Metrics.recordProxyBlock(
        {
          server_name: this.serverName,
          block_reason: 'request_timeout',
          rule: 'request-timeout',
          tenant_id: reqCtx?.tenantId,
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
      this.sendError(requestId, -32006, `MCP Guardian: ${reason}`, { rule: 'request-timeout' });
      this.requestContexts.delete(requestId);
      this.currentRequestId = null;
    }, resolveToolTimeoutMs(toolName, this.requestTimeoutMs));
  }

  private recordDeniedCall(
    toolName: string,
    requestTokens: number,
    durationMs: number,
    blockRule: string,
    blockReason: string,
    requestArguments?: Record<string, unknown>,
    tenantId?: string,
  ): void {
    const tid = tenantId || this.defaultTenantId;
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
      tenantId: tid,
    };
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
    return this.clientInputQueue.enqueue(requestKey, () => this.processClientInput(raw));
  }

  private async processClientInput(raw: string): Promise<void> {
    // ── Payload size guard ──────────────────────────────────
    if (Buffer.byteLength(raw, 'utf8') > MAX_PAYLOAD_BYTES) {
      Logger.warn(
        `[Proxy] Oversized payload rejected: ${Buffer.byteLength(raw, 'utf8')} bytes > ${MAX_PAYLOAD_BYTES} byte limit. Increase MCP_GUARDIAN_MAX_PAYLOAD_BYTES to allow.`
      );
      try {
        const msg = JSON.parse(raw);
        if (msg.id) {
          this.sendError(msg.id, -32001, 'Payload exceeds MCP Guardian size limit');
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

      if (msg.method === 'initialize') {
        const initAuth = OAuthValidator.extractAuthFromMcpMessage(msg);
        if (initAuth) this.sessionAuthHeader = initAuth;
      }

      if (msg.method === 'tools/list' && msg.id != null) {
        this.pendingToolsListIds.add(msg.id);
      }

      if (msg.method === 'tools/call' && msg.id) {
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
            `MCP Guardian: proxy overloaded (${this.requestContexts.size}/${maxInflightEarly} in flight)`,
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
          this.sendError(msg.id, -32001, 'Blocked by MCP Guardian policy: tool definitions changed mid-session (rug-pull)', {
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
        const requestArguments = msg.params?.arguments;

        // ── P0 Week 3: DLP on tool call arguments (runtime exfiltration) ──
        if (requestArguments) {
          const multimodalFindings = scanMultimodalContent(requestArguments);
          if (multimodalFindings.length > 0 && this.policyEngine?.getMode() === 'block') {
            const mmReason = multimodalFindings.map((f) => f.description).slice(0, 3).join('; ');
            this.recordDeniedCall(toolName, requestTokens, Date.now() - proxyStartTime, 'multimodal-injection', mmReason);
            this.sendError(msg.id, -32001, `Blocked by MCP Guardian policy: ${mmReason}`, {
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
                this.sendError(msg.id, -32001, `Blocked by MCP Guardian policy: ${entropyReason}`, {
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
                `Blocked by MCP Guardian policy: ${dlpReason}`,
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
          const stickySessionAuth = process.env['GUARDIAN_STICKY_SESSION_AUTH'] === 'true';
          const authHeader = msgAuth ?? (stickySessionAuth ? this.sessionAuthHeader : undefined);

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

        // ── CVE gate (latest security_scans row; run preflight or `mcp-guardian scan`) ──
        if (this.policyEngine?.getMode() === 'block') {
          const cveGate = await evaluateCveGate(this.db, this.serverName);
          if (cveGate.block) {
            const cveReason = cveGate.reason || 'CVE policy violation';
            this.recordDeniedCall(toolName, requestTokens, Date.now() - proxyStartTime, 'cve-gate', cveReason);
            StructuredLogger.info({
              event: 'request_denied',
              requestId,
              serverName: this.serverName,
              toolName,
              blockReason: `cve:${cveReason}`,
              proxyLatencyMs: Date.now() - proxyStartTime,
            });
            Metrics.recordProxyBlock(
              {
                server_name: this.serverName,
                block_reason: 'cve_gate',
                rule: 'cve-gate',
                tenant_id: requestTenantId,
              },
              'cve',
            );
            Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'block', authn_success: String(authnSuccess) });
            this.sendError(msg.id, -32001, `Blocked by MCP Guardian CVE policy: ${cveReason}`, {
              rule: 'cve-gate',
              policy: 'block',
            });
            return;
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

        // ── RBAC + policy evaluation ────────────────────────
        let authzAllowed = true;
        let blockReason: string | undefined;

        const engine =
          this.tenantPolicyRegistry?.getEngine(requestTenantId) ?? this.policyEngine;

        if (engine) {
          const tenantId = requestTenantId;
          const idempotencyKey = idempotencyKeyFromRequest(
            msg.params?._meta as Record<string, unknown> | undefined,
          );
          const context: CallContext = {
            serverName: this.serverName,
            toolName,
            arguments: requestArguments,
            requestId,
            requestTokens,
            timestamp: new Date().toISOString(),
            tenantId,
            agentIdentity,
            idempotencyKey,
          };

          const decision = await engine.evaluateAsync(context);
          await waitProxyTimingNormalize(proxyStartTime);

          ingestPolicyDecision({
            requestId,
            serverName: this.serverName,
            toolName,
            action: decision.action,
            rule: decision.rule,
            reason: decision.reason,
            timestamp: context.timestamp,
            requestTokens,
          });

          StructuredLogger.logPolicyDecision({
            event: 'policy_decision',
            requestId,
            serverName: this.serverName,
            toolName,
            decision,
            context,
          });

          const policyMode = engine.getMode();
          const shouldDeny = decision.action === 'block'
            || (decision.action === 'flag' && policyMode === 'block');

          if (shouldDeny) {
            authzAllowed = false;
            blockReason = `policy:${decision.rule}:${decision.reason}`;
            this.recordDeniedCall(
              toolName,
              requestTokens,
              Date.now() - proxyStartTime,
              decision.rule,
              decision.reason,
              requestArguments,
              requestTenantId,
            );

            StructuredLogger.logBlocked({
              event: 'tool_blocked',
              requestId,
              serverName: this.serverName,
              toolName,
              reason: `policy_rule=${decision.rule} | reason=${decision.reason}`,
              rule: decision.rule,
            });

            StructuredLogger.info({
              event: 'request_denied',
              requestId,
              serverName: this.serverName,
              toolName,
              authnSuccess,
              authzAllowed,
              blockReason,
              proxyLatencyMs: Date.now() - proxyStartTime,
            });

            Metrics.recordProxyBlock(
              {
                server_name: this.serverName,
                block_reason: blockReason || 'policy',
                rule: decision.rule,
                tenant_id: context.tenantId,
              },
            );
            Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'block', authn_success: String(authnSuccess) });
            void alertPolicyBlock(this.serverName, toolName, decision.rule, decision.reason, requestId);
            this.sendError(msg.id, -32001, `Blocked by MCP Guardian policy: ${decision.reason}`, {
              rule: decision.rule,
              policy: policyMode,
            });
            return;
          }

          if (isSemanticAsyncEnabled(context.tenantId) && !isSemanticLlmConfigured()) {
            reportSemanticDegradation('llm_unavailable', {
              serverName: this.serverName,
              toolName,
            });
            if (isSemanticStrictMode(context.tenantId)) {
              this.recordDeniedCall(
                toolName,
                requestTokens,
                Date.now() - proxyStartTime,
                'semantic-degraded',
                'Semantic LLM layer unavailable (GUARDIAN_SEMANTIC_STRICT=true)',
              );
              this.sendError(msg.id, -32001, 'Blocked: semantic LLM layer unavailable', {
                rule: 'semantic-degraded',
                policy: 'block',
              });
              return;
            }
          }

          if (isSyncSemanticRequestEnabled(context.tenantId)) {
            const semGate = await runSyncSemanticRequestGate(context, decision, this.serverName);
            if (semGate.block) {
              this.recordDeniedCall(
                toolName,
                requestTokens,
                Date.now() - proxyStartTime,
                semGate.rule,
                semGate.reason,
                requestArguments,
                requestTenantId,
              );
              this.sendError(msg.id, -32001, `Blocked by MCP Guardian semantic gate: ${semGate.reason}`, {
                rule: semGate.rule,
                policy: 'block',
              });
              return;
            }
          }

          enqueueSemanticAudit(buildSemanticAuditJob(context, decision));
          recordSessionToolCall(context);
        }


        this.requestContexts.set(msg.id, {
          requestStartTime: proxyStartTime,
          requestToolName: toolName,
          requestTokens,
          requestRaw: raw,
          requestModel,
          requestArguments,
          tenantId: requestTenantId,
          agentIdentity,
          rotatedSessionToken: pendingRotatedSessionToken,
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
      }
    } catch {
      // non-JSON — no timeout arm
    }

    this.child.stdin?.write(raw + '\n');
  }

  /** Atomically swap the active policy engine (used by hot-reload) */
  setPolicyEngine(engine: PolicyEngine): void {
    this.policyEngine = engine;
    Logger.info(`[proxy:${this.serverName}] Policy engine hot-swapped — mode: ${engine.getMode()}`);
  }

  kill(): void {
    this.clearRequestTimeout();
    try {
      this.child.kill();
    } catch {
      // Already dead
    }
  }
}
