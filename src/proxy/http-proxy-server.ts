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
import { MtlsConfig, createMtlsAgent } from '../utils/mtls-config.js';
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
  sanitizeResponseHeaders,
  validateHostHeader,
  validateRequestHeaders,
  validateRequestUrlPath,
} from './http-proxy-security.js';

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
  private httpsAgent: HttpsAgent | undefined;

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
    this.httpsAgent = createMtlsAgent(mtlsConfig || { enabled: false, rejectUnauthorized: true });
    Metrics.circuitBreakerState.set({ server_name: this.serverName }, 0);
    if (this.httpsAgent) {
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
          const sessionIdentity = await validateSessionToken(this.sessionCache, token, requestTenantId);
          if (sessionIdentity) {
            result = { valid: true, identity: sessionIdentity };
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
        if (msg.method === 'tools/call') {
          const toolName = msg.params?.name || 'unknown';
          const tokens = this.tokenCounter.count(body);

          const context: CallContext = {
            serverName: this.serverName,
            toolName,
            arguments: msg.params?.arguments,
            requestId,
            requestTokens: tokens,
            timestamp: new Date().toISOString(),
            tenantId: requestTenantId,
            agentIdentity,
          };

          const decision = await this.policyEngine.evaluateAsync(context);

          if (decision.action === 'block') {
            Metrics.blockedRequestsTotal.inc({ server_name: this.serverName, block_reason: `policy:${decision.rule}`, rule: decision.rule });
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
        timeout: 30000, // 30s upstream timeout (mirrors SseProxyServer)
      };

      // Attach mTLS agent for HTTPS connections
      if (isHttps && this.httpsAgent) {
        reqOpts.agent = this.httpsAgent;
      }

      const proxyReq = (isHttps ? httpsReq : httpReq)(reqOpts, (upstreamRes) => {
        const safeHeaders = sanitizeResponseHeaders(upstreamRes.headers);
        applySafeCorsHeaders(req.headers, safeHeaders);
        res.writeHead(upstreamRes.statusCode || 200, safeHeaders);
        upstreamRes.pipe(res);
        // Record success on 'end', not when headers arrive — avoids false success on mid-stream drops
        upstreamRes.on('end', () => {
          tenantBreaker.recordSuccess();
          Metrics.circuitBreakerState.set({ server_name: this.serverName }, tenantBreaker.getState() === 'OPEN' ? 1 : 0);
          Metrics.proxyLatencyMs.observe({ server_name: this.serverName }, Date.now() - start);
          Metrics.requestsTotal.inc({ server_name: this.serverName, decision: 'pass', authn_success: String(authnSuccess) });
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