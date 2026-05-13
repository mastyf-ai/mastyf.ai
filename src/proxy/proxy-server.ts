import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { randomUUID } from 'crypto';
import { TokenCounter } from '../utils/token-counter.js';
import { ProxyCallRecord } from '../types.js';
import { HistoryDatabase } from '../database/history-db.js';
import { Logger } from '../utils/logger.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { CallContext } from '../policy/policy-types.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { OAuthValidator } from '../auth/oauth.js';
import { AuthValidationResult, AgentIdentity } from '../auth/auth-types.js';
import { SessionCache } from '../auth/session-cache.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { LRUCache } from 'lru-cache';
import { detectPromptInjection } from '../scanners/prompt-injection-detector.js';
import * as Metrics from '../utils/metrics.js';

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
  private db: HistoryDatabase;
  private currentRequestId: string | null = null;
  private requestStartTime: number = 0;
  private requestToolName: string | null = null;
  private requestTokens: number = 0;
  private requestArguments: Record<string, unknown> | undefined;
  private serverName: string;
  private policyEngine: PolicyEngine | null;
  private authValidator: OAuthValidator | null;
  private sessionCache: SessionCache | null;
  private circuitBreaker: CircuitBreaker;
  /** Per-client rate limit counters — LRU-backed to prevent memory leaks */
  private clientRateCounters: LRUCache<string, { count: number; resetAt: number }> = new LRUCache({
    max: 10000,
    ttl: 60000,
    updateAgeOnGet: true,
  });

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
    db: HistoryDatabase,
    serverName?: string,
    policyEngine?: PolicyEngine,
    authValidator?: OAuthValidator,
    requestTimeoutMs: number = 30000,
    maxRestarts: number = 5,
  ) {
    this.serverName = serverName || command.split('/').pop() || command;
    this.policyEngine = policyEngine || null;
    this.authValidator = authValidator || null;
    this.sessionCache = authValidator ? new SessionCache() : null;
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
        if (msg.id && msg.id === this.currentRequestId) {
          const proxyLatencyMs = Date.now() - this.requestStartTime;
          const responseTokens = this.tokenCounter.count(line);
          const record: ProxyCallRecord = {
            serverName: this.serverName,
            toolName: this.requestToolName || 'unknown',
            requestTokens: this.requestTokens,
            responseTokens,
            totalTokens: this.requestTokens + responseTokens,
            durationMs: proxyLatencyMs,
            timestamp: new Date().toISOString(),
          };
          this.db.addCallRecord(record).catch((err) =>
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

            if (injectionFindings.length > 0 || allDetections.length > 0) {
              const allMessages = [
                ...allDetections,
                ...injectionFindings.map(f => `${f.severity.toUpperCase()}: ${f.description} (${f.matchPreview})`),
              ];

              const hasCritical = injectionFindings.some(f => f.severity === 'critical');

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
                requestId: this.currentRequestId,
              });

              Metrics.injectionDetectedTotal?.inc({
                server_name: this.serverName,
                severity: hasCritical ? 'critical' : 'high',
              });
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
        this.requestTokens = this.tokenCounter.count(raw);
        this.requestArguments = msg.params?.arguments;
        const toolName = this.requestToolName || 'unknown';

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
            const result: AuthValidationResult = await this.authValidator.validate(token);
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
            agentIdentity,
          };

          const decision = this.policyEngine.evaluate(context);

          StructuredLogger.logPolicyDecision({
            event: 'policy_decision',
            requestId,
            serverName: this.serverName,
            toolName,
            decision,
            context,
          });

          if (decision.action === 'block') {
            authzAllowed = false;
            blockReason = `policy:${decision.rule}:${decision.reason}`;

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
            this.sendError(msg.id, -32001, `Blocked by MCP Guardian policy: ${decision.reason}`, {
              rule: decision.rule,
              policy: this.policyEngine.getMode(),
            });
            return;
          }

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
