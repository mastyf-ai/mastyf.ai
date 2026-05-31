import { createServer, IncomingMessage, ServerResponse } from 'http';
import { request as httpReq } from 'http';
import { request as httpsReq, Agent as HttpsAgent } from 'https';
import { randomUUID } from 'crypto';
import { TokenCounter } from '../utils/token-counter.js';
import { ProxyCallRecord } from '../types.js';
import { HistoryDatabase } from '../database/history-db.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { CallContext } from '../policy/policy-types.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { OAuthValidator } from '../auth/oauth.js';
import { AuthValidationResult, AgentIdentity } from '../auth/auth-types.js';
import { createSessionCache, validateSessionToken, type GuardianSessionCache } from '../auth/session-factory.js';
import { getCircuitBreaker } from '../utils/circuit-breaker-registry.js';
import type { MtlsConfig } from '../utils/mtls-config.js';
import { getMtlsAgent } from '../utils/mtls-agent-registry.js';
import * as Metrics from '../utils/metrics.js';
import { Logger } from '../utils/logger.js';
import { extractDpopProof, validateRequiredDpop } from '../auth/dpop-enforcement.js';
import { resolveTenantContext, InvalidTenantIdError, DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import {
  applySafeCorsHeaders,
  getHttpMaxBodyBytes,
  isXmlContentType,
  looksLikeXmlBody,
  parseJsonWithDepthLimit,
  validateHostHeader,
  validateRequestHeaders,
  validateRequestUrlPath,
  validateResponseHeaders,
} from './http-proxy-security.js';
import { findingsToMessages, isResponseScanSkipped } from '../utils/streaming-inspector.js';
import { gateToolResponseText } from '../utils/response-security-gate.js';
import { formatRedactionHeader, injectRedactionMeta } from '../utils/redaction-meta.js';
import { injectRotatedSessionIntoResult } from '../utils/mcp-session-meta.js';
import { getUpstreamTimeoutMs } from '../utils/upstream-timeout.js';
import { acquireProxyInflight, releaseProxyInflight } from './proxy-inflight.js';
import { runSyncSemanticRequestGate } from './proxy-post-policy-gates.js';
import { runToolCallPreForwardGuard, toolCallGuardBlockResponse } from './tool-call-pre-guard.js';
import { applyGeoToCallContext } from '../utils/request-geo-context.js';
import { runMcpPrePipeline, applyMcpResponsePipeline, mcpResponseBlockJson } from './mcp-request-pipeline.js';
import { hasJsonRpcId } from './json-rpc-utils.js';
import {
  fingerprintJsonRpcToolsList,
  isRugPullBlockedForCall,
} from './rug-pull-transport.js';
import type { ToolFingerprintState } from './tool-fingerprint.js';

/**
 * HTTP/SSE Proxy for remote MCP servers.
 * Reuses the same auth, policy, circuit breaker, and metrics stack as the stdio proxy.
 */
export class HttpProxyServer {
  private serverName: string;
  private targetUrl: string;
  private policyEngine: PolicyEngine | null;
  private authValidator: OAuthValidator | null;
  private sessionCache: GuardianSessionCache | null;
  private defaultTenantId: string;
  private tokenCounter: TokenCounter;
  private db: HistoryDatabase;
  private port: number;
  private server: ReturnType<typeof createServer> | null = null;
  private readonly rugPullState: ToolFingerprintState = { fingerprint: null, blocked: false };

  constructor(
    targetUrl: string,
    serverName: string,
    policyEngine?: PolicyEngine,
    authValidator?: OAuthValidator,
    db?: HistoryDatabase,
    port: number = 4000,
    mtlsConfig?: MtlsConfig,
  ) {
    this.serverName = serverName;
    this.targetUrl = targetUrl.replace(/\/$/, '');
    this.policyEngine = policyEngine || null;
    this.authValidator = authValidator || null;
    this.sessionCache = authValidator ? createSessionCache() : null;
    this.defaultTenantId = resolveTenantContext().tenantId;
    this.tokenCounter = new TokenCounter();
    this.db = db || new HistoryDatabase(':memory:');
    this.port = port;
    void mtlsConfig;
    getMtlsAgent();
    Metrics.circuitBreakerState.set({ server_name: this.serverName }, 0);
    if (getMtlsAgent()) {
      Logger.info(`[http-proxy:${this.serverName}] mTLS enabled for upstream connection`);
    }
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, () => {
        this.server!.removeListener('error', reject);
        Logger.info(`[http-proxy:${this.serverName}] Listening on http://0.0.0.0:${this.port} → ${this.targetUrl}`);
        resolve();
      });
    });
  }

  private breakerFor(tenantId: string = DEFAULT_TENANT_ID) {
    return getCircuitBreaker(tenantId || this.defaultTenantId, this.serverName);
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    const start = Date.now();

    let requestTenantId = this.defaultTenantId;
    try {
      requestTenantId = resolveTenantContext({
        headers: req.headers as Record<string, string | string[] | undefined>,
      }).tenantId;
    } catch (err) {
      if (err instanceof InvalidTenantIdError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      throw err;
    }

    const tenantBreaker = this.breakerFor(requestTenantId);

    const pathError = validateRequestUrlPath(req.url);
    if (pathError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: pathError }));
      return;
    }

    const headerError = validateRequestHeaders(req.headers);
    if (headerError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: headerError }));
      return;
    }

    const hostError = validateHostHeader(req.headers.host);
    if (hostError) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: hostError }));
      return;
    }

    // ── Auth check ───────────────────────────────────────────
    let agentIdentity: AgentIdentity | undefined;
    let authnSuccess = false;
    let rotatedSessionToken: string | undefined;

    if (this.authValidator) {
      const authHeader = req.headers['authorization'];
      const token = OAuthValidator.extractToken(authHeader);

      if (!token && this.authValidator.getConfig().required) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      if (token) {
        let result: AuthValidationResult = await this.authValidator.validate(token);
        if (!result.valid && this.sessionCache) {
          const sessionResult = await validateSessionToken(this.sessionCache, token, requestTenantId);
          if (sessionResult) {
            result = { valid: true, identity: sessionResult.identity };
            if (sessionResult.rotatedToken) {
              rotatedSessionToken = sessionResult.rotatedToken;
              res.setHeader('x-mcp-guardian-session-token', sessionResult.rotatedToken);
            }
          }
        }
        authnSuccess = result.valid;
        if (result.identity) agentIdentity = result.identity;

        if (!result.valid && this.authValidator.getConfig().required) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Authentication failed: ${result.error}` }));
          return;
        }

        if (result.valid && token) {
          const dpopProof = extractDpopProof({ headerDpop: req.headers['dpop'] });
          const requestUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}${req.url || '/'}`;
          const dpopCheck = await validateRequiredDpop(
            dpopProof,
            req.method || 'POST',
            requestUrl,
            token,
            requestTenantId,
          );
          if (!dpopCheck.valid) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: dpopCheck.error || 'DPoP validation failed' }));
            return;
          }
        }
      }
    }

    if (!this.authValidator) {
      const dpopProof = extractDpopProof({ headerDpop: req.headers['dpop'] });
      const requestUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}${req.url || '/'}`;
      const dpopCheck = await validateRequiredDpop(
        dpopProof,
        req.method || 'POST',
        requestUrl,
        undefined,
        requestTenantId,
      );
      if (!dpopCheck.valid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: dpopCheck.error || 'DPoP validation failed' }));
        return;
      }
    }

    // ── Circuit breaker ──────────────────────────────────────
    if (!tenantBreaker.allowRequest()) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service unavailable — circuit breaker open' }));
      Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'block', authn_success: String(authnSuccess) });
      return;
    }

    // ── Read body ────────────────────────────────────────────
    const MAX_BODY_SIZE = getHttpMaxBodyBytes();
    const chunks: Buffer[] = [];
    let totalSize = 0;
    for await (const chunk of req) {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString();

    const contentType = req.headers['content-type'];
    const ct = Array.isArray(contentType) ? contentType[0] : contentType;
    if (isXmlContentType(ct) || (body.length > 0 && looksLikeXmlBody(body))) {
      res.writeHead(415, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'XML payloads are not supported' }));
      return;
    }

    if (ct?.toLowerCase().includes('application/json') && body.length > 0) {
      const parsed = parseJsonWithDepthLimit(body);
      if (!parsed.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: parsed.error }));
        return;
      }
    }

    let toolsCallId: string | number | undefined;
    let toolsCallName: string | undefined;
    let mcpResourcePromptId: string | number | undefined;
    let mcpResourcePromptMethod: string | undefined;
    let mcpResourceSessionId: string | undefined;

    // ── Policy evaluation (if tools/call) ────────────────────
    if (this.policyEngine) {
      try {
        const parsed = parseJsonWithDepthLimit(body);
        if (!parsed.ok) {
          throw new Error(parsed.error);
        }
        const msg = parsed.value as {
          method?: string;
          id?: unknown;
          params?: { name?: string; arguments?: Record<string, unknown> };
        };

        const pre = runMcpPrePipeline({
          msg: msg as Record<string, unknown>,
          serverName: this.serverName,
          authenticated: authnSuccess,
          fallbackSessionKey: requestId,
        });
        if (pre.blocked && hasJsonRpcId(msg.id)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(pre.response));
          return;
        }
        if (!pre.blocked && pre.trackResponse && pre.requestMethod && msg.id != null) {
          mcpResourcePromptId = msg.id as string | number;
          mcpResourcePromptMethod = pre.requestMethod;
          mcpResourceSessionId = pre.session.sessionId;
        }

        if (msg.method === 'tools/call') {
          const toolName = msg.params?.name || 'unknown';
          if (msg.id != null) {
            toolsCallId = msg.id as string | number;
            toolsCallName = toolName;
          }
          if (await isRugPullBlockedForCall(this.rugPullState, this.serverName, requestTenantId)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                error: {
                  code: -32001,
                  message:
                    'Blocked by MCP Guardian policy: tool definitions changed mid-session (rug-pull)',
                },
              }),
            );
            return;
          }
          const inflight = acquireProxyInflight(this.serverName);
          if (!inflight.ok) {
            Metrics.proxyInflightRejectedTotal.inc(
              Metrics.withTenantMetricLabels(
                { server_name: this.serverName },
                requestTenantId,
              ),
            );
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                error: {
                  code: -32005,
                  message: `MCP Guardian: proxy overloaded (${inflight.current}/${inflight.max} in flight)`,
                },
              }),
            );
            return;
          }
          const tokens = this.tokenCounter.count(body);

          let requestArguments = msg.params?.arguments as Record<string, unknown> | undefined;
          const preGuard = await runToolCallPreForwardGuard(
            this.serverName,
            toolName,
            requestArguments,
            String(msg.id),
            {
              agentId: agentIdentity?.sub,
              meta: (msg.params as Record<string, unknown> | undefined)?._meta as Record<string, unknown> | undefined,
              headers: req.headers,
            },
          );
          if (preGuard.blocked && hasJsonRpcId(msg.id)) {
            releaseProxyInflight(this.serverName);
            StructuredLogger.logBlocked({
              event: 'tool_blocked',
              requestId: String(msg.id),
              serverName: this.serverName,
              toolName,
              reason: preGuard.message,
              rule: 'payload_or_agentic',
            });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(toolCallGuardBlockResponse(msg.id, preGuard)));
            return;
          }
          if (!preGuard.blocked && preGuard.arguments) {
            requestArguments = preGuard.arguments;
          }

          const context: CallContext = applyGeoToCallContext({
            serverName: this.serverName,
            toolName,
            arguments: requestArguments,
            requestId,
            requestTokens: tokens,
            timestamp: new Date().toISOString(),
            tenantId: requestTenantId,
            agentIdentity,
          }, req.headers);

          const decision = await this.policyEngine.evaluateAsync(context);

          if (decision.action === 'block') {
            releaseProxyInflight(this.serverName);
            StructuredLogger.logBlocked({
              event: 'tool_blocked',
              requestId,
              serverName: this.serverName,
              toolName,
              reason: decision.reason,
              rule: decision.rule,
            });
            Metrics.recordProxyBlock(
              {
                server_name: this.serverName,
                block_reason: `policy:${decision.rule}`,
                rule: decision.rule,
                tenant_id: requestTenantId,
              },
            );
            Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'block', authn_success: String(authnSuccess) });
            const rateLimited =
              /rate\s*limit/i.test(decision.reason || '') ||
              /rate/i.test(decision.rule || '');
            res.writeHead(rateLimited ? 429 : 403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              error: { code: -32001, message: `Blocked by MCP Guardian policy: ${decision.reason}` },
            }));
            return;
          }

          const semGate = await runSyncSemanticRequestGate(context, decision, this.serverName);
          if (semGate.block) {
            releaseProxyInflight(this.serverName);
            StructuredLogger.logBlocked({
              event: 'tool_blocked',
              requestId,
              serverName: this.serverName,
              toolName,
              reason: semGate.reason,
              rule: 'semantic_gate',
            });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                error: {
                  code: -32001,
                  message: `Blocked by MCP Guardian semantic gate: ${semGate.reason}`,
                },
              }),
            );
            return;
          }
        }
      } catch {
        // Not JSON — forward to target anyway
      }
    }

    // ── Forward to upstream ──────────────────────────────────
    try {
      const upstreamUrl = new URL(this.targetUrl + (req.url || '/'));
      const isHttps = upstreamUrl.protocol === 'https:';

      const reqOpts: any = {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || (isHttps ? 443 : 80),
        path: upstreamUrl.pathname + upstreamUrl.search,
        method: req.method,
        headers: { ...req.headers, host: upstreamUrl.hostname },
        timeout: getUpstreamTimeoutMs(),
      };

      // Attach mTLS agent for HTTPS connections
      const agent = getMtlsAgent();
      if (isHttps && agent) {
        reqOpts.agent = agent;
      }

      const proxyReq = (isHttps ? httpsReq : httpReq)(reqOpts, (upstreamRes) => {
        const headerCheck = validateResponseHeaders(
          upstreamRes.headers as Record<string, string | string[] | undefined>,
        );
        if (!headerCheck.ok) {
          Logger.error(`[http-proxy:${this.serverName}] Invalid upstream response headers: ${headerCheck.error}`);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'MCP Guardian: Invalid response headers from upstream',
            }));
          }
          upstreamRes.resume();
          tenantBreaker.recordFailure();
          return;
        }
        const safeHeaders = { ...upstreamRes.headers } as Record<string, string | string[] | undefined>;
        applySafeCorsHeaders(req.headers, safeHeaders);
        const gateResponse = toolsCallId != null && toolsCallName != null;
        const gateResourcePrompt = mcpResourcePromptId != null && mcpResourcePromptMethod != null;

        const recordSuccess = () => {
          if (toolsCallId != null) {
            releaseProxyInflight(this.serverName);
          }
          tenantBreaker.recordSuccess();
          Metrics.circuitBreakerState.set(
            { server_name: this.serverName },
            tenantBreaker.getState() === 'OPEN' ? 1 : 0,
          );
          Metrics.proxyLatencyMs.observe({ server_name: this.serverName }, Date.now() - start);
          Metrics.requestsTotal.inc({
            server_name: this.serverName,
            decision: 'pass',
            authn_success: String(authnSuccess),
          });
        };

        if (!gateResponse && !gateResourcePrompt) {
          const ct = String(upstreamRes.headers['content-type'] || '');
          if (ct.toLowerCase().includes('application/json')) {
            const respChunks: Buffer[] = [];
            let respSize = 0;
            upstreamRes.on('data', (chunk: Buffer) => {
              respSize += chunk.length;
              if (respSize > MAX_BODY_SIZE) {
                upstreamRes.destroy();
                if (!res.headersSent) {
                  res.writeHead(413, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Upstream response too large' }));
                }
                return;
              }
              respChunks.push(chunk);
            });
            upstreamRes.on('end', () => {
              void (async () => {
                try {
                  const raw = Buffer.concat(respChunks).toString();
                  const parsed = parseJsonWithDepthLimit(raw);
                  if (parsed.ok) {
                    fingerprintJsonRpcToolsList(
                      this.rugPullState,
                      parsed.value,
                      this.serverName,
                      requestTenantId,
                      `[http-proxy:${this.serverName}]`,
                    );
                  }
                  if (!res.headersSent) {
                    res.writeHead(upstreamRes.statusCode || 200, safeHeaders);
                    res.end(raw);
                  }
                  recordSuccess();
                } catch {
                  tenantBreaker.recordFailure();
                }
              })();
            });
            upstreamRes.on('error', () => {
              tenantBreaker.recordFailure();
              Metrics.circuitBreakerState.set({ server_name: this.serverName }, 1);
            });
            return;
          }
          res.writeHead(upstreamRes.statusCode || 200, safeHeaders);
          upstreamRes.pipe(res);
          upstreamRes.on('end', recordSuccess);
          upstreamRes.on('error', () => {
            tenantBreaker.recordFailure();
            Metrics.circuitBreakerState.set({ server_name: this.serverName }, 1);
          });
          return;
        }

        if (gateResourcePrompt && !gateResponse) {
          const rpChunks: Buffer[] = [];
          let rpSize = 0;
          upstreamRes.on('data', (chunk: Buffer) => {
            rpSize += chunk.length;
            if (rpSize > MAX_BODY_SIZE) {
              upstreamRes.destroy();
              return;
            }
            rpChunks.push(chunk);
          });
          upstreamRes.on('end', () => {
            void (async () => {
              try {
                const raw = Buffer.concat(rpChunks).toString();
                const parsed = parseJsonWithDepthLimit(raw);
                if (!parsed.ok) {
                  if (!res.headersSent) {
                    res.writeHead(upstreamRes.statusCode || 200, safeHeaders);
                    res.end(raw);
                  }
                  recordSuccess();
                  return;
                }
                const msg = parsed.value as Record<string, unknown>;
                const rp = applyMcpResponsePipeline({
                  method: mcpResourcePromptMethod!,
                  result: (msg as { result?: unknown }).result,
                  sessionId: mcpResourceSessionId ?? requestId,
                });
                if (rp.blocked) {
                  if (!res.headersSent) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(mcpResponseBlockJson(mcpResourcePromptId, rp.reason ?? 'blocked')));
                  }
                  return;
                }
                if (rp.result !== undefined) {
                  (msg as { result: unknown }).result = rp.result;
                }
                const outbound = JSON.stringify(msg);
                if (!res.headersSent) {
                  res.writeHead(upstreamRes.statusCode || 200, safeHeaders);
                  res.end(outbound);
                }
                recordSuccess();
              } catch {
                tenantBreaker.recordFailure();
              }
            })();
          });
          upstreamRes.on('error', () => tenantBreaker.recordFailure());
          return;
        }

        const respChunks: Buffer[] = [];
        let respSize = 0;
        upstreamRes.on('data', (chunk: Buffer) => {
          respSize += chunk.length;
          if (respSize > MAX_BODY_SIZE) {
            upstreamRes.destroy();
            if (!res.headersSent) {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Upstream response too large' }));
            }
            tenantBreaker.recordFailure();
            return;
          }
          respChunks.push(chunk);
        });

        upstreamRes.on('end', () => {
          void (async () => {
            try {
              const raw = Buffer.concat(respChunks).toString();
              let outbound = raw;
              let redactionReasons: string[] | undefined;
              const parsed = parseJsonWithDepthLimit(raw);
              if (parsed.ok) {
                const msg = parsed.value as Record<string, unknown>;
                fingerprintJsonRpcToolsList(
                  this.rugPullState,
                  msg,
                  this.serverName,
                  requestTenantId,
                  `[http-proxy:${this.serverName}]`,
                );
                const inspected = await this.inspectToolResponse(
                  toolsCallName!,
                  msg,
                  toolsCallId!,
                  requestTenantId,
                );
                redactionReasons = inspected.redactionReasons;
                if (inspected.blocked) {
                  if (!res.headersSent) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(inspected.blocked));
                  }
                  Metrics.recordProxyBlock(
                    {
                      server_name: this.serverName,
                      block_reason: 'response_gate',
                      rule: 'response-gate',
                      tenant_id: requestTenantId,
                    },
                    'response_gate',
                  );
                  Metrics.requestsTotal.inc({
                    server_name: this.serverName,
                    decision: 'block',
                    authn_success: String(authnSuccess),
                  });
                  return;
                }
                injectRotatedSessionIntoResult(msg, rotatedSessionToken);
                outbound = JSON.stringify(msg);
              }
              if (rotatedSessionToken) {
                res.setHeader('x-mcp-guardian-session-token', rotatedSessionToken);
              }
              const redactionHdr = formatRedactionHeader(redactionReasons);
              if (redactionHdr) {
                safeHeaders['x-guardian-redaction-reason'] = redactionHdr;
              }
              delete safeHeaders['content-length'];
              delete safeHeaders['Content-Length'];
              delete safeHeaders['transfer-encoding'];
              delete safeHeaders['Transfer-Encoding'];
              safeHeaders['content-length'] = String(Buffer.byteLength(outbound));
              if (!res.headersSent) {
                res.writeHead(upstreamRes.statusCode || 200, safeHeaders);
              }
              res.end(outbound);
              recordSuccess();
            } catch (err: unknown) {
              tenantBreaker.recordFailure();
              const message = err instanceof Error ? err.message : String(err);
              if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Response gate error: ${message}` }));
              }
            }
          })();
        });

        upstreamRes.on('error', () => {
          tenantBreaker.recordFailure();
          Metrics.circuitBreakerState.set({ server_name: this.serverName }, 1);
        });
      });

      proxyReq.on('error', (err) => {
        tenantBreaker.recordFailure();
        Metrics.circuitBreakerState.set({ server_name: this.serverName }, 1);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Upstream error: ${err.message}` }));
        }
      });

      proxyReq.on('timeout', () => {
        proxyReq.destroy();
        tenantBreaker.recordFailure();
        Metrics.circuitBreakerState.set({ server_name: this.serverName }, 1);
        if (!res.headersSent) {
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Upstream timeout' }));
        }
      });

      proxyReq.write(body);
      proxyReq.end();
    } catch (err: any) {
      tenantBreaker.recordFailure();
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
      }
    }
  }

  private async inspectToolResponse(
    toolName: string,
    response: Record<string, unknown>,
    requestId: string | number,
    tenantId?: string,
  ): Promise<{ blocked: Record<string, unknown> | null; redactionReasons?: string[] }> {
    const result = (response as { result?: unknown }).result;
    if (result == null || isResponseScanSkipped()) return { blocked: null };

    const responseText = JSON.stringify(result);
    const gate = await gateToolResponseText({
      responseText,
      toolName,
      serverName: this.serverName,
      policy: this.policyEngine,
      requestId,
      tenantId,
    });
    const inspect = gate.inspect;
    if (inspect && !inspect.clean) {
      const allMessages = findingsToMessages(inspect.findings);
      Logger.warn(
        `[http-proxy:${this.serverName}] Suspicious response from '${toolName}': ${allMessages.slice(0, 5).join('; ')}`,
      );
      StructuredLogger.info({
        event: 'response_flagged',
        serverName: this.serverName,
        toolName,
        detections: allMessages,
        blocked: gate.outcome.action === 'block',
      });
    }

    if (gate.outcome.action === 'redact' && gate.outcome.body) {
      try {
        const parsed = JSON.parse(gate.outcome.body) as unknown;
        (response as { result: unknown }).result = injectRedactionMeta(parsed, gate.outcome.redactionReasons);
      } catch {
        /* keep upstream */
      }
      return { blocked: null, redactionReasons: gate.outcome.redactionReasons };
    }

    if (gate.outcome.action === 'block') {
      return {
        blocked: {
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: -32002,
            message: gate.outcome.message,
          },
        },
      };
    }
    return { blocked: null };
  }

  getPort(): number {
    const addr = this.server?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return this.port;
  }

  getServerName(): string {
    return this.serverName;
  }

  getTargetUrl(): string {
    return this.targetUrl;
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>(r => this.server!.close(() => r()));
      this.server = null;
    }
  }
}