import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { randomUUID, createHash } from 'crypto';
import {
  TokenCounter,
  countImageTokensInPayload,
  extractModelFromPayload,
} from '../utils/token-counter.js';
import { ProxyCallRecord } from '../types.js';
import { IDatabase } from '../database/database-interface.js';
import { Logger } from '../utils/logger.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { CallContext } from '../policy/policy-types.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { OAuthValidator } from '../auth/oauth.js';
import { AuthValidationResult, AgentIdentity } from '../auth/auth-types.js';
import { createSessionCache, validateSessionToken, type GuardianSessionCache } from '../auth/session-factory.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { LRUCache } from 'lru-cache';
import { detectPromptInjection } from '../scanners/prompt-injection-detector.js';
import { scanForSecrets } from '../scanners/secret-scanner.js';
import { isProxyEntropyCheckEnabled, scanArgumentEntropy } from '../utils/arg-entropy.js';
import * as Metrics from '../utils/metrics.js';
import { alertPolicyBlock } from '../alerting/webhook-alerter.js';
import { evaluateCveGate } from '../utils/cve-gate.js';
import { persistCallRecord } from '../utils/call-record-cost.js';
import { onPolicyBlock, fingerprintArgs, ingestPolicyDecision } from '../ai/block-learning.js';
import { buildSemanticAuditJob, enqueueSemanticAudit } from '../ai/async-semantic-audit.js';
import type { HistoryDatabase } from '../database/history-db.js';

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
  private currentRequestId: string | null = null;
  private requestStartTime: number = 0;
  private requestToolName: string | null = null;
  private requestTokens: number = 0;
  private requestRaw: string | null = null;
  private requestModel: string | undefined;
  private requestArguments: Record<string, unknown> | undefined;
  private serverName: string;
  private policyEngine: PolicyEngine | null;
  private authValidator: OAuthValidator | null;
  private sessionCache: GuardianSessionCache | null;
  private circuitBreaker: CircuitBreaker;
  /** Per-client rate limit counters — LRU-backed to prevent memory leaks */
  private clientRateCounters: LRUCache<string, { count: number; resetAt: number }> = new LRUCache({
    max: 10000,
    ttl: 60000,
    updateAgeOnGet: true,
  });

  /** P0 Week 2: SHA-256 fingerprint of the tools/list response at session init.
   *  Compared on every subsequent tools/list to detect rug-pull attacks
   *  (OWASP MCP03 — server mutates tool descriptions mid-session). */
  private toolFingerprint: string | null = null;

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
  ) {
    this.serverName = serverName || command.split('/').pop() || command;
    this.policyEngine = policyEngine || null;
    this.authValidator = authValidator || null;
    this.sessionCache = authValidator ? createSessionCache() : null;
    this.circuitBreaker = new CircuitBreaker(this.serverName);
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

    StructuredLogger.info({
      event: 'proxy_started',
      serverName: this.serverName,
      blockingMode: this.policyEngine ? this.policyEngine.getMode() : 'audit',
      authEnabled: this.authValidator ? this.authValidator.getConfig().required : false,
      circuitBreaker: this.circuitBreaker.getState(),
      requestTimeoutMs: this.requestTimeoutMs,
    });
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
      try {
        const msg = JSON.parse(line);

        // ── P0 Week 2: Rug-pull detection via tool definition fingerprinting ──
        if (!msg.id && msg.result?.tools && Array.isArray(msg.result.tools)) {
          const canonical = JSON.stringify(msg.result.tools.map((t: any) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })).sort((a: any, b: any) => a.name.localeCompare(b.name)));
          const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);

          if (!this.toolFingerprint) {
            this.toolFingerprint = hash;
            Logger.debug(`[proxy:${this.serverName}] Tool fingerprint registered: ${hash} (${msg.result.tools.length} tools)`);
          } else if (this.toolFingerprint !== hash) {
            const prev = this.toolFingerprint;
            this.toolFingerprint = hash;
            const alert = `[proxy:${this.serverName}] 🚨 RUG-PULL DETECTED (OWASP MCP03): tool definitions changed mid-session. Previous fingerprint: ${prev}, New: ${hash}. Server may have been compromised.`;
            Logger.error(alert);
            StructuredLogger.info({
              event: 'rug_pull_detected' as any,
              serverName: this.serverName,
              previousFingerprint: prev,
              currentFingerprint: hash,
              toolCount: msg.result.tools.length,
            });
            Metrics.blockedRequestsTotal?.inc({
              server_name: this.serverName,
              block_reason: 'rug_pull',
              rule: 'tool-fingerprint-mismatch',
            });
          }
        }

        if (msg.id && msg.id === this.currentRequestId) {
          const proxyLatencyMs = Date.now() - this.requestStartTime;
          const reqMsg = {
            params: { name: this.requestToolName, arguments: this.requestArguments },
          };
          const model =
            this.requestModel ||
            process.env.GUARDIAN_MODEL ||
            process.env.ANTHROPIC_MODEL ||
            process.env.OPENAI_MODEL;
          const counts = this.tokenCounter.countProxyCall({
            requestText: this.requestRaw || JSON.stringify(reqMsg),
            responseText: line,
            model,
            requestPayload: reqMsg,
            responsePayload: msg,
          });
          const record: ProxyCallRecord = {
            serverName: this.serverName,
            toolName: this.requestToolName || 'unknown',
            requestTokens: counts.requestTokens,
            responseTokens: counts.responseTokens,
            totalTokens: counts.totalTokens,
            durationMs: proxyLatencyMs,
            timestamp: new Date().toISOString(),
            tokenSource: counts.tokenSource,
          };
          persistCallRecord(this.db, record, reqMsg).catch((err) =>
            Logger.debug(`Proxy: failed to store call record: ${err?.message}`)
          );
          this.circuitBreaker.recordSuccess();
          Metrics.circuitBreakerState.set({ server_name: this.serverName }, this.circuitBreaker.getState() === 'CLOSED' ? 0 : this.circuitBreaker.getState() === 'OPEN' ? 1 : 2);
          Metrics.proxyLatencyMs.observe({ server_name: this.serverName }, proxyLatencyMs);
          Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'pass', authn_success: 'true' });
          if (this.sessionCache) Metrics.activeSessions.set(this.sessionCache.size);

          // ── v2.5+: Response inspection for prompt injection / data exfiltration ──
          if (msg?.result) {
            const responseText = JSON.stringify(msg.result);

            // Layer 1: Policy engine patterns (exfiltration URLs, token queries, base64)
            const allDetections: string[] = [];
            if (this.policyEngine) {
              const { clean, detections } = this.policyEngine.evaluateResponse(
                this.requestToolName || 'unknown',
                this.serverName,
                responseText,
              );
              if (!clean) allDetections.push(...detections);
            }

            // Layer 2: Dedicated prompt injection detector (jailbreak, role override, credential theft, etc.)
            const injectionFindings = detectPromptInjection(
              this.requestToolName || 'unknown',
              responseText,
            );

            const hasCritical = injectionFindings.some(f => f.severity === 'critical');
            const hasHigh = injectionFindings.some(f => f.severity === 'high');
            const hasDetections = injectionFindings.length > 0 || allDetections.length > 0;

            if (hasDetections) {
              const allMessages = [
                ...allDetections,
                ...injectionFindings.map(f => `${f.severity.toUpperCase()}: ${f.description} (${f.matchPreview})`),
              ];

              Logger.warn(
                `[proxy:${this.serverName}] Suspicious response from '${this.requestToolName}': ${allMessages.slice(0, 5).join('; ')}` +
                (allMessages.length > 5 ? `... (+${allMessages.length - 5} more)` : '')
              );

              StructuredLogger.info({
                event: 'response_flagged',
                serverName: this.serverName,
                toolName: this.requestToolName,
                detections: allMessages,
                criticalCount: injectionFindings.filter(f => f.severity === 'critical').length,
                highCount: injectionFindings.filter(f => f.severity === 'high').length,
                blocked: (hasCritical || hasHigh) && this.policyEngine?.getMode() === 'block',
                requestId: this.currentRequestId,
              });

              Metrics.injectionDetectedTotal?.inc({
                server_name: this.serverName,
                severity: hasCritical ? 'critical' : 'high',
              });
            }

            // ═══ BLOCK response forwarding when policy is in block mode ═══
            const policyMode = this.policyEngine?.getMode() ?? 'audit';
            if ((hasCritical || hasHigh) && policyMode === 'block') {
              // Record as blocked
              const blockedRecord: ProxyCallRecord = {
                serverName: this.serverName,
                toolName: this.requestToolName || 'unknown',
                requestTokens: this.requestTokens,
                responseTokens: 0,
                totalTokens: this.requestTokens,
                durationMs: Date.now() - this.requestStartTime,
                timestamp: new Date().toISOString(),
              };
              persistCallRecord(this.db, { ...blockedRecord, blocked: true, blockRule: 'response-inspection' }).catch(() => {});
              Metrics.blockedRequestsTotal.inc({
                server_name: this.serverName,
                block_reason: hasCritical ? 'response_injection_critical' : 'response_injection_high',
                rule: 'response-inspection',
              });
              Metrics.requestsTotal.inc({
                server_name: this.serverName,
                decision: 'block',
                authn_success: 'true',
              });

              // Send error response instead of the malicious upstream response
              this.sendError(
                msg.id,
                -32002,
                'MCP Guardian: Tool response blocked — ' +
                  `${hasCritical ? 'critical' : 'high'}-severity prompt injection detected`
              );
              this.currentRequestId = null;
              this.requestToolName = null;
              return; // ❌ Do NOT forward the malicious response to the AI client
            }
          }

          this.currentRequestId = null;
          this.requestToolName = null;
        }
        process.stdout.write(line + '\n');
      } catch {
        process.stdout.write(line + '\n');
      }
    });

    rl.on('close', () => {
      Logger.debug(`[proxy:${this.serverName}] stdout closed`);
    });
  }

  private setupStderr(): void {
    this.child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
    });
  }

  private sendError(id: string | number, code: number, message: string, data?: Record<string, unknown>): void {
    const errorResponse = JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    });
    process.stdout.write(errorResponse + '\n');
  }

  private recordDeniedCall(
    toolName: string,
    requestTokens: number,
    durationMs: number,
    blockRule: string,
    blockReason: string,
  ): void {
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
    };
    persistCallRecord(this.db, record).catch((err) =>
      Logger.debug(`Proxy: failed to store denied call record: ${err?.message}`)
    );
    onPolicyBlock(
      {
        block_rule: blockRule,
        toolName,
        serverName: this.serverName,
        argsFingerprint: fingerprintArgs(this.requestArguments),
      },
      { db: this.db as HistoryDatabase },
    );
  }

  /**
   * Called when the AI client writes a request to be proxied.
   * Pipeline: Payload guard → Auth → Circuit Breaker → Policy + RBAC → Forward.
   */
  async handleClientInput(raw: string): Promise<void> {
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
      if (msg.method === 'tools/call' && msg.id) {
        this.requestStartTime = proxyStartTime;
        this.currentRequestId = msg.id;
        this.requestToolName = msg.params?.name || 'unknown';
        this.requestRaw = raw;
        this.requestModel =
          extractModelFromPayload(msg) ||
          process.env.GUARDIAN_MODEL ||
          process.env.ANTHROPIC_MODEL ||
          process.env.OPENAI_MODEL;
        const reqEstimate =
          this.tokenCounter.countWithProvider(raw, this.requestModel)?.tokens ??
          this.tokenCounter.count(raw);
        const imageTokens = countImageTokensInPayload(msg.params?.arguments);
        this.requestTokens = reqEstimate + imageTokens;
        this.requestArguments = msg.params?.arguments;
        const toolName = this.requestToolName || 'unknown';

        // ── P0 Week 3: DLP on tool call arguments (runtime exfiltration) ──
        if (this.requestArguments) {
          const argString = JSON.stringify(this.requestArguments);
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
                this.recordDeniedCall(toolName, this.requestTokens, Date.now() - proxyStartTime, 'arg-entropy', entropyReason);
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
              this.recordDeniedCall(toolName, this.requestTokens, Date.now() - proxyStartTime, 'secret-scan', dlpReason);
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
              Metrics.blockedRequestsTotal.inc({ server_name: this.serverName, block_reason: 'dlp_secrets_in_args', rule: 'secret-scan' });
              Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'block', authn_success: 'true' });
              return;
            }
          }
        }

        let agentIdentity: AgentIdentity | undefined;
        let authnSuccess = false;

        // ── OAuth 2.1 JWT validation ────────────────────────
        if (this.authValidator) {
          const authHeader = msg.params?._meta?.auth?.Authorization
            || msg.Authorization
            || msg.params?.Authorization
            || undefined;

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
              const sessionIdentity = await validateSessionToken(this.sessionCache, token);
              if (sessionIdentity) {
                result = { valid: true, identity: sessionIdentity };
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
              if (this.sessionCache && result.identity) {
                const session = this.sessionCache.createSession(result.identity);
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
            this.recordDeniedCall(toolName, this.requestTokens, Date.now() - proxyStartTime, 'cve-gate', cveReason);
            StructuredLogger.info({
              event: 'request_denied',
              requestId,
              serverName: this.serverName,
              toolName,
              blockReason: `cve:${cveReason}`,
              proxyLatencyMs: Date.now() - proxyStartTime,
            });
            Metrics.blockedRequestsTotal.inc({ server_name: this.serverName, block_reason: 'cve_gate', rule: 'cve-gate' });
            Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'block', authn_success: String(authnSuccess) });
            this.sendError(msg.id, -32001, `Blocked by MCP Guardian CVE policy: ${cveReason}`, {
              rule: 'cve-gate',
              policy: 'block',
            });
            return;
          }
        }

        // ── Circuit breaker check ───────────────────────────
        if (!this.circuitBreaker.allowRequest()) {
          StructuredLogger.info({
            event: 'circuit_open',
            requestId,
            serverName: this.serverName,
            toolName,
            state: this.circuitBreaker.getState(),
          });
          this.sendError(msg.id, -32005, `Upstream MCP server '${this.serverName}' unavailable — circuit breaker open`);
          this.circuitBreaker.recordFailure();
          return;
        }

        // ── RBAC + policy evaluation ────────────────────────
        let authzAllowed = true;
        let blockReason: string | undefined;

        if (this.policyEngine) {
          const context: CallContext = {
            serverName: this.serverName,
            toolName,
            arguments: this.requestArguments,
            requestId,
            requestTokens: this.requestTokens,
            timestamp: new Date().toISOString(),
            tenantId: process.env['GUARDIAN_TENANT_ID'] || msg.params?._meta?.tenantId as string | undefined,
            agentIdentity,
          };

          const decision = await this.policyEngine.evaluateAsync(context);

          ingestPolicyDecision({
            requestId,
            serverName: this.serverName,
            toolName,
            action: decision.action,
            rule: decision.rule,
            reason: decision.reason,
            timestamp: context.timestamp,
            requestTokens: this.requestTokens,
          });

          StructuredLogger.logPolicyDecision({
            event: 'policy_decision',
            requestId,
            serverName: this.serverName,
            toolName,
            decision,
            context,
          });

          const policyMode = this.policyEngine.getMode();
          const shouldDeny = decision.action === 'block'
            || (decision.action === 'flag' && policyMode === 'block');

          if (shouldDeny) {
            authzAllowed = false;
            blockReason = `policy:${decision.rule}:${decision.reason}`;
            this.recordDeniedCall(toolName, this.requestTokens, Date.now() - proxyStartTime, decision.rule, decision.reason);

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

            Metrics.blockedRequestsTotal.inc({ server_name: this.serverName, block_reason: blockReason || 'policy', rule: decision.rule });
            Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'block', authn_success: String(authnSuccess) });
            void alertPolicyBlock(this.serverName, toolName, decision.rule, decision.reason, requestId);
            this.sendError(msg.id, -32001, `Blocked by MCP Guardian policy: ${decision.reason}`, {
              rule: decision.rule,
              policy: policyMode,
            });
            return;
          }

          enqueueSemanticAudit(buildSemanticAuditJob(context, decision));

          // Per-client rate limiting
          if (agentIdentity) {
            const rateKey = `${agentIdentity.sub}:${toolName}`;
            const now = Date.now();
            let counter = this.clientRateCounters.get(rateKey);
            if (!counter || now > counter.resetAt) {
              counter = { count: 1, resetAt: now + 60000 };
            } else {
              counter.count++;
            }
            this.clientRateCounters.set(rateKey, counter);
            const perClientLimit = this.checkPerClientRateLimit(agentIdentity, toolName, counter.count);
            if (perClientLimit) {
              StructuredLogger.info({
                event: 'request_denied',
                requestId,
                serverName: this.serverName,
                toolName,
                authnSuccess,
                authzAllowed: false,
                blockReason: perClientLimit,
                proxyLatencyMs: Date.now() - proxyStartTime,
              });
              this.sendError(msg.id, -32004, `Rate limit exceeded for agent '${agentIdentity.sub}': ${perClientLimit}`);
              return;
            }
          }
        }

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
    this.child.stdin?.write(raw + '\n');
  }

  /**
   * Check per-client rate limits against RBAC rules.
   * Returns block reason string or null.
   */
  private checkPerClientRateLimit(identity: AgentIdentity, _toolName: string, currentCount: number): string | null {
    if (!this.policyEngine) return null;
    const scopes = identity.scopes || [];
    if (scopes.length === 0 && currentCount > 100) {
      return `Per-client rate limit exceeded: ${currentCount}/100 calls per minute (agent: ${identity.sub})`;
    }
    return null;
  }

  /** Atomically swap the active policy engine (used by hot-reload) */
  setPolicyEngine(engine: PolicyEngine): void {
    this.policyEngine = engine;
    Logger.info(`[proxy:${this.serverName}] Policy engine hot-swapped — mode: ${engine.getMode()}`);
  }

  kill(): void {
    try {
      this.child.kill();
    } catch {
      // Already dead
    }
  }
}
