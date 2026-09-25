import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { request as httpReq } from 'http';
import { request as httpsReq } from 'https';
import { randomUUID } from 'crypto';
import { TokenCounter } from '../utils/token-counter.js';
import { HistoryDatabase } from '../database/history-db.js';
import { StructuredLogger } from '../utils/structured-logger.js';
import { checkHttpClientRateLimit } from './client-rate-limit.js';
import { checkIngressRateLimit } from './ingress-rate-limit.js';
import { OAuthValidator } from '../auth/oauth.js';
import { createSessionCache, validateSessionToken } from '../auth/session-factory.js';
import { getCircuitBreaker } from '../utils/circuit-breaker-registry.js';
import { getMtlsAgent } from '../utils/mtls-agent-registry.js';
import * as Metrics from '../utils/metrics.js';
import { Logger } from '../utils/logger.js';
import { requireUpstreamTlsAllowed } from '../utils/upstream-tls.js';
import { loadInboundTlsFromEnv } from '../utils/inbound-tls.js';
import { extractDpopProof, validateRequiredDpop } from '../auth/dpop-enforcement.js';
import { resolveTenantContext, InvalidTenantIdError, DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';
import { applySafeCorsHeaders, getHttpMaxBodyBytes, isXmlContentType, looksLikeXmlBody, parseJsonWithDepthLimit, validateHostHeader, validateRequestHeaders, validateRequestUrlPath, validateResponseHeaders, } from './http-proxy-security.js';
import { formatRedactionHeader } from '../utils/redaction-meta.js';
import { inspectToolResponse as sharedInspectToolResponse } from './response-inspection.js';
import { injectRotatedSessionIntoResult } from '../utils/mcp-session-meta.js';
import { getUpstreamTimeoutMs } from '../utils/upstream-timeout.js';
import { acquireProxyInflight, releaseProxyInflight } from './proxy-inflight.js';
import { evaluateToolCallDefense } from './tool-call-defense-orchestrator.js';
import { runMcpPrePipeline, applyMcpResponsePipeline, mcpResponseBlockJson } from './mcp-request-pipeline.js';
import { hasJsonRpcId } from './json-rpc-utils.js';
import { fingerprintJsonRpcToolsList, } from './rug-pull-transport.js';
import { injectIntoUpstreamHeaders, runWithExtractedTraceAsync, withMcpToolCallSpan, } from './trace-context.js';
import { runWithEphemeralCredentialVault } from '../security/ephemeral-credential-vault.js';
import { captureRequestSecrets } from './proxy-request-context.js';
/**
 * HTTP/SSE Proxy for remote MCP servers.
 * Reuses the same auth, policy, circuit breaker, and metrics stack as the stdio proxy.
 */
export class HttpProxyServer {
    serverName;
    targetUrl;
    policyEngine;
    authValidator;
    sessionCache;
    defaultTenantId;
    tokenCounter;
    db;
    port;
    inboundTls;
    server = null;
    rugPullState = { fingerprint: null, blocked: false };
    constructor(targetUrl, serverName, policyEngine, authValidator, db, port = 4000, mtlsConfig) {
        this.serverName = serverName;
        this.targetUrl = targetUrl.replace(/\/$/, '');
        requireUpstreamTlsAllowed(this.targetUrl);
        this.inboundTls = loadInboundTlsFromEnv();
        if (process.env['MASTYF_AI_REQUIRE_INBOUND_TLS'] === 'true' && !this.inboundTls) {
            throw new Error('MASTYF_AI_REQUIRE_INBOUND_TLS=true requires inbound TLS cert/key (MASTYF_AI_TLS_CERT_PATH + MASTYF_AI_TLS_KEY_PATH)');
        }
        if (process.env['MASTYF_AI_AUTH_REQUIRED'] === 'true' && !authValidator) {
            throw new Error('MASTYF_AI_AUTH_REQUIRED=true requires an OAuthValidator when creating HttpProxyServer');
        }
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
    async start() {
        const handler = (req, res) => {
            void this.handleRequest(req, res);
        };
        this.server = this.inboundTls
            ? createHttpsServer({ cert: this.inboundTls.cert, key: this.inboundTls.key }, handler)
            : createServer(handler);
        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.port, () => {
                this.server.removeListener('error', reject);
                const scheme = this.inboundTls ? 'https' : 'http';
                Logger.info(`[http-proxy:${this.serverName}] Listening on ${scheme}://0.0.0.0:${this.port} → ${this.targetUrl}`);
                resolve();
            });
        });
    }
    breakerFor(tenantId = DEFAULT_TENANT_ID) {
        return getCircuitBreaker(tenantId || this.defaultTenantId, this.serverName);
    }
    async handleRequest(req, res) {
        return runWithEphemeralCredentialVault(() => runWithExtractedTraceAsync(req.headers, () => this.dispatchRequest(req, res)));
    }
    async dispatchRequest(req, res) {
        const requestId = randomUUID();
        const start = Date.now();
        let requestTenantId = this.defaultTenantId;
        try {
            requestTenantId = resolveTenantContext({
                headers: req.headers,
            }).tenantId;
        }
        catch (err) {
            if (err instanceof InvalidTenantIdError) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }
            throw err;
        }
        const tenantBreaker = this.breakerFor(requestTenantId);
        const ingressLimit = await checkIngressRateLimit(requestTenantId);
        if (!ingressLimit.allowed) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: ingressLimit.reason ?? 'Too many requests' }));
            return;
        }
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
        let agentIdentity;
        let authnSuccess = false;
        let rotatedSessionToken;
        if (this.authValidator) {
            const authHeader = req.headers['authorization'];
            const token = OAuthValidator.extractToken(authHeader);
            if (!token && this.authValidator.getConfig().required) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Authentication required' }));
                return;
            }
            if (token) {
                let result = await this.authValidator.validate(token);
                if (!result.valid && this.sessionCache) {
                    const sessionResult = await validateSessionToken(this.sessionCache, token, requestTenantId);
                    if (sessionResult) {
                        result = { valid: true, identity: sessionResult.identity };
                        if (sessionResult.rotatedToken) {
                            rotatedSessionToken = sessionResult.rotatedToken;
                            res.setHeader('x-mastyf-ai-session-token', sessionResult.rotatedToken);
                        }
                    }
                }
                authnSuccess = result.valid;
                if (result.identity)
                    agentIdentity = result.identity;
                if (!result.valid && this.authValidator.getConfig().required) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Authentication failed: ${result.error}` }));
                    return;
                }
                if (result.valid && token) {
                    const dpopProof = extractDpopProof({ headerDpop: req.headers['dpop'] });
                    const requestUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}${req.url || '/'}`;
                    const dpopCheck = await validateRequiredDpop(dpopProof, req.method || 'POST', requestUrl, token, requestTenantId);
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
            const dpopCheck = await validateRequiredDpop(dpopProof, req.method || 'POST', requestUrl, undefined, requestTenantId);
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
        const chunks = [];
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
        captureRequestSecrets(body, req.headers);
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
        let toolsCallId;
        let toolsCallName;
        let toolsCallArgs;
        let mcpResourcePromptId;
        let mcpResourcePromptMethod;
        let mcpResourceSessionId;
        // ── Policy evaluation (if tools/call) ────────────────────
        if (this.policyEngine) {
            try {
                const parsed = parseJsonWithDepthLimit(body);
                if (!parsed.ok) {
                    throw new Error(parsed.error);
                }
                const msg = parsed.value;
                const pre = runMcpPrePipeline({
                    msg: msg,
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
                    mcpResourcePromptId = msg.id;
                    mcpResourcePromptMethod = pre.requestMethod;
                    mcpResourceSessionId = pre.session.sessionId;
                }
                if (msg.method === 'tools/call') {
                    const toolName = msg.params?.name || 'unknown';
                    if (msg.id != null) {
                        toolsCallId = msg.id;
                        toolsCallName = toolName;
                        toolsCallArgs = msg.params?.arguments;
                    }
                    const inflight = acquireProxyInflight(this.serverName);
                    if (!inflight.ok) {
                        Metrics.proxyInflightRejectedTotal.inc(Metrics.withTenantMetricLabels({ server_name: this.serverName }, requestTenantId));
                        res.writeHead(503, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id: msg.id,
                            error: {
                                code: -32005,
                                message: `Mastyf AI: proxy overloaded (${inflight.current}/${inflight.max} in flight)`,
                            },
                        }));
                        return;
                    }
                    const tokens = this.tokenCounter.count(body);
                    const clientRl = await checkHttpClientRateLimit(agentIdentity?.sub || 'anonymous', toolName, requestTenantId);
                    if (!clientRl.allowed) {
                        releaseProxyInflight(this.serverName);
                        StructuredLogger.logBlocked({
                            event: 'tool_blocked',
                            requestId: String(msg.id),
                            serverName: this.serverName,
                            toolName,
                            reason: clientRl.reason || 'rate limit',
                            rule: 'client_rate_limit',
                        });
                        res.writeHead(429, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id: msg.id,
                            error: { code: -32001, message: `Blocked by MCP Mastyf AI rate limit: ${clientRl.reason}` },
                        }));
                        return;
                    }
                    const defense = await evaluateToolCallDefense({
                        serverName: this.serverName,
                        toolName,
                        arguments: msg.params?.arguments,
                        requestId,
                        requestTokens: tokens,
                        tenantId: requestTenantId,
                        agentIdentity,
                        headers: req.headers,
                        meta: msg.params?._meta,
                        agentId: agentIdentity?.sub,
                    }, {
                        policyEngine: this.policyEngine,
                        db: this.db,
                        rugPullState: this.rugPullState,
                    });
                    if (!defense.allowed) {
                        releaseProxyInflight(this.serverName);
                        if (defense.phase === 'pre-guard' && defense.preGuard && hasJsonRpcId(msg.id)) {
                            const { toolCallGuardBlockResponse } = await import('./tool-call-pre-guard.js');
                            res.writeHead(403, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(toolCallGuardBlockResponse(msg.id, defense.preGuard)));
                            return;
                        }
                        const status = defense.httpStatus ?? 403;
                        res.writeHead(status, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id: msg.id,
                            error: { code: defense.code, message: `Blocked by MCP Mastyf AI: ${defense.reason}` },
                        }));
                        return;
                    }
                    if (defense.arguments && msg.params) {
                        msg.params.arguments = defense.arguments;
                        toolsCallArgs = defense.arguments;
                    }
                }
            }
            catch {
                // Not JSON — forward to target anyway
            }
        }
        // ── Forward to upstream ──────────────────────────────────
        const executeForward = async () => {
            try {
                const upstreamUrl = new URL(this.targetUrl + (req.url || '/'));
                const isHttps = upstreamUrl.protocol === 'https:';
                const reqOpts = {
                    hostname: upstreamUrl.hostname,
                    port: upstreamUrl.port || (isHttps ? 443 : 80),
                    path: upstreamUrl.pathname + upstreamUrl.search,
                    method: req.method,
                    headers: injectIntoUpstreamHeaders(req.headers, { host: upstreamUrl.hostname }),
                    timeout: getUpstreamTimeoutMs(),
                };
                // Attach mTLS agent for HTTPS connections
                const agent = getMtlsAgent();
                if (isHttps && agent) {
                    reqOpts.agent = agent;
                }
                const proxyReq = (isHttps ? httpsReq : httpReq)(reqOpts, (upstreamRes) => {
                    const headerCheck = validateResponseHeaders(upstreamRes.headers);
                    if (!headerCheck.ok) {
                        Logger.error(`[http-proxy:${this.serverName}] Invalid upstream response headers: ${headerCheck.error}`);
                        if (!res.headersSent) {
                            res.writeHead(502, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                error: 'Mastyf AI: Invalid response headers from upstream',
                            }));
                        }
                        upstreamRes.resume();
                        tenantBreaker.recordFailure();
                        return;
                    }
                    const safeHeaders = { ...upstreamRes.headers };
                    applySafeCorsHeaders(req.headers, safeHeaders);
                    const gateResponse = toolsCallId != null && toolsCallName != null;
                    const gateResourcePrompt = mcpResourcePromptId != null && mcpResourcePromptMethod != null;
                    const recordSuccess = () => {
                        if (toolsCallId != null) {
                            releaseProxyInflight(this.serverName);
                        }
                        tenantBreaker.recordSuccess();
                        Metrics.circuitBreakerState.set({ server_name: this.serverName }, tenantBreaker.getState() === 'OPEN' ? 1 : 0);
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
                            const respChunks = [];
                            let respSize = 0;
                            upstreamRes.on('data', (chunk) => {
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
                                            fingerprintJsonRpcToolsList(this.rugPullState, parsed.value, this.serverName, requestTenantId, `[http-proxy:${this.serverName}]`);
                                        }
                                        if (!res.headersSent) {
                                            res.writeHead(upstreamRes.statusCode || 200, safeHeaders);
                                            res.end(raw);
                                        }
                                        recordSuccess();
                                    }
                                    catch {
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
                        const rpChunks = [];
                        let rpSize = 0;
                        upstreamRes.on('data', (chunk) => {
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
                                    const msg = parsed.value;
                                    const rp = applyMcpResponsePipeline({
                                        method: mcpResourcePromptMethod,
                                        result: msg.result,
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
                                        msg.result = rp.result;
                                    }
                                    const outbound = JSON.stringify(msg);
                                    if (!res.headersSent) {
                                        res.writeHead(upstreamRes.statusCode || 200, safeHeaders);
                                        res.end(outbound);
                                    }
                                    recordSuccess();
                                }
                                catch {
                                    tenantBreaker.recordFailure();
                                }
                            })();
                        });
                        upstreamRes.on('error', () => tenantBreaker.recordFailure());
                        return;
                    }
                    const respChunks = [];
                    let respSize = 0;
                    upstreamRes.on('data', (chunk) => {
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
                                let redactionReasons;
                                const parsed = parseJsonWithDepthLimit(raw);
                                if (parsed.ok) {
                                    const msg = parsed.value;
                                    fingerprintJsonRpcToolsList(this.rugPullState, msg, this.serverName, requestTenantId, `[http-proxy:${this.serverName}]`);
                                    const inspected = await sharedInspectToolResponse({
                                        response: msg,
                                        toolName: toolsCallName,
                                        serverName: this.serverName,
                                        requestId: toolsCallId,
                                        tenantId: requestTenantId,
                                        policyEngine: this.policyEngine,
                                        transportLabel: 'http-proxy',
                                        toolArguments: toolsCallArgs,
                                    });
                                    if (inspected.blocked) {
                                        if (!res.headersSent) {
                                            res.writeHead(403, { 'Content-Type': 'application/json' });
                                            res.end(JSON.stringify(inspected.blockResponse));
                                        }
                                        Metrics.recordProxyBlock({
                                            server_name: this.serverName,
                                            block_reason: 'response_gate',
                                            rule: 'response-gate',
                                            tenant_id: requestTenantId,
                                        }, 'response_gate');
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
                                    res.setHeader('x-mastyf-ai-session-token', rotatedSessionToken);
                                }
                                const redactionHdr = formatRedactionHeader(redactionReasons);
                                if (redactionHdr) {
                                    safeHeaders['x-mastyf-ai-redaction-reason'] = redactionHdr;
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
                            }
                            catch (err) {
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
            }
            catch (err) {
                tenantBreaker.recordFailure();
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `Proxy error: ${err instanceof Error ? err.message : String(err)}` }));
                }
            }
        };
        if (toolsCallName) {
            await withMcpToolCallSpan({
                serverName: this.serverName,
                toolName: toolsCallName,
                tenantId: requestTenantId,
                transport: 'http',
            }, executeForward);
        }
        else {
            await executeForward();
        }
    }
    getPort() {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object')
            return addr.port;
        return this.port;
    }
    getServerName() {
        return this.serverName;
    }
    getTargetUrl() {
        return this.targetUrl;
    }
    async stop() {
        if (this.server) {
            await new Promise(r => this.server.close(() => r()));
            this.server = null;
        }
    }
}
//# sourceMappingURL=http-proxy-server.js.map