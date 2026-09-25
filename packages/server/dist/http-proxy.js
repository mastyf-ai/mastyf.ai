/**
 * HTTP/SSE Transparent Proxy for Cost Auditing (v2.1).
 *
 * Intercepts HTTP requests to upstream MCP servers, inspects JSON-RPC tools/call
 * payloads, runs token counting and policy evaluation, then forwards to the target.
 */
import * as http from 'http';
import * as https from 'https';
import { runHttpProxyAuthGate, sendAuthGateFailure } from './http-proxy-auth.js';
import { getMaxBodyBytes, getUpstreamTimeoutMs, loadInboundTlsFromEnv, readRequestBodyWithLimit, relayToUpstream, assertUpstreamTlsAllowed, isPlaintextUpstreamAllowed, } from './http-proxy-utils.js';
export function createHttpProxy(targetUrl, policyEngine, db, tokenCounter, options = {}) {
    const target = targetUrl.replace(/\/$/, '');
    const upstreamTls = assertUpstreamTlsAllowed(target);
    if (!upstreamTls.ok) {
        throw new Error(upstreamTls.message);
    }
    if (isPlaintextUpstreamAllowed()) {
        console.warn('[http-proxy] MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM=true — upstream tool traffic may use cleartext HTTP (dev only)');
    }
    const maxBodyBytes = options.maxBodyBytes ?? getMaxBodyBytes();
    const upstreamTimeoutMs = options.upstreamTimeoutMs ?? getUpstreamTimeoutMs();
    const authValidator = options.authValidator ?? null;
    const upstreamAgent = options.upstreamAgent;
    const defenseHook = options.defenseHook ?? null;
    const proxyServerName = options.serverName ?? target;
    const defaultTenantId = options.tenantId ?? 'default';
    const inboundTls = options.tls ?? loadInboundTlsFromEnv();
    if (process.env.MASTYF_AI_REQUIRE_INBOUND_TLS === 'true' && !inboundTls) {
        throw new Error('MASTYF_AI_REQUIRE_INBOUND_TLS=true requires inbound TLS cert/key (options.tls or MCP_INBOUND_TLS_*)');
    }
    if (process.env.MASTYF_AI_AUTH_REQUIRED === 'true' && !authValidator) {
        throw new Error('MASTYF_AI_AUTH_REQUIRED=true requires an authValidator when creating the HTTP proxy');
    }
    const handler = async (clientReq, clientRes) => {
        const start = Date.now();
        if (authValidator) {
            const authResult = await runHttpProxyAuthGate(clientReq, authValidator);
            if (!authResult.ok) {
                sendAuthGateFailure(clientRes, authResult);
                return;
            }
        }
        const buildUpstreamUrl = () => new URL(target + (clientReq.url ?? '/'));
        const forwardHeaders = (upstream, extra) => ({
            ...clientReq.headers,
            host: upstream.hostname,
            ...extra,
        });
        if (clientReq.method !== 'POST') {
            relayToUpstream({
                upstream: buildUpstreamUrl(),
                method: clientReq.method || 'GET',
                headers: forwardHeaders(buildUpstreamUrl()),
                clientRes,
                clientReq,
                timeoutMs: upstreamTimeoutMs,
                agent: upstreamAgent,
            });
            return;
        }
        const bodyResult = await readRequestBodyWithLimit(clientReq, maxBodyBytes);
        if (!bodyResult.ok) {
            clientRes.writeHead(413, { 'Content-Type': 'application/json' });
            clientRes.end(JSON.stringify({
                error: 'Request body too large',
                limit: bodyResult.limit,
                bytes: bodyResult.bytes,
            }));
            return;
        }
        const rawBody = bodyResult.body;
        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        }
        catch {
            const upstream = buildUpstreamUrl();
            relayToUpstream({
                upstream,
                method: clientReq.method || 'POST',
                headers: forwardHeaders(upstream, { 'content-length': String(Buffer.byteLength(rawBody)) }),
                body: rawBody,
                clientRes,
                timeoutMs: upstreamTimeoutMs,
                agent: upstreamAgent,
                jsonRpcId: parsed?.id,
            });
            return;
        }
        if (parsed.method === 'tools/call') {
            const toolName = parsed.params?.name || 'unknown';
            const inputTokens = tokenCounter.count(rawBody);
            const requestId = String(parsed.id ?? '');
            if (defenseHook) {
                const defense = await defenseHook.evaluate({
                    serverName: proxyServerName,
                    toolName,
                    arguments: parsed.params?.arguments || {},
                    requestId,
                    requestTokens: inputTokens,
                    tenantId: defaultTenantId,
                });
                if (!defense.allowed) {
                    clientRes.writeHead(defense.httpStatus ?? 403, { 'Content-Type': 'application/json' });
                    clientRes.end(JSON.stringify({
                        jsonrpc: '2.0',
                        id: parsed.id,
                        error: {
                            code: defense.code,
                            message: `Blocked: ${defense.reason}`,
                            data: { rule: defense.rule },
                        },
                    }));
                    return;
                }
                if (defense.arguments && parsed.params) {
                    parsed.params.arguments = defense.arguments;
                }
            }
            else if (policyEngine) {
                const policyResult = policyEngine.evaluate({
                    toolName,
                    arguments: parsed.params?.arguments || {},
                    serverName: target,
                    requestTokens: inputTokens,
                    timestamp: new Date().toISOString(),
                });
                if (policyResult.action === 'block') {
                    clientRes.writeHead(403, { 'Content-Type': 'application/json' });
                    clientRes.end(JSON.stringify({
                        jsonrpc: '2.0',
                        id: parsed.id,
                        error: {
                            code: -32000,
                            message: `Blocked: ${policyResult.reason}`,
                            data: { rule: policyResult.rule },
                        },
                    }));
                    return;
                }
            }
            const upstream = buildUpstreamUrl();
            relayToUpstream({
                upstream,
                method: 'POST',
                headers: forwardHeaders(upstream, { 'content-length': String(Buffer.byteLength(rawBody)) }),
                body: rawBody,
                clientRes,
                timeoutMs: upstreamTimeoutMs,
                agent: upstreamAgent,
                maxResponseBytes: maxBodyBytes,
                jsonRpcId: parsed.id,
                onBufferedResponse: async (responseBody, upstreamRes) => {
                    let outputTokens = 0;
                    try {
                        const responseJson = JSON.parse(responseBody);
                        if (responseJson.result?.content) {
                            outputTokens = tokenCounter.count(responseJson.result.content.map((c) => c.text || '').join(''));
                        }
                        else {
                            outputTokens = tokenCounter.count(responseBody);
                        }
                    }
                    catch {
                        outputTokens = tokenCounter.count(responseBody);
                    }
                    if (!clientRes.headersSent) {
                        clientRes.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
                        clientRes.end(responseBody);
                    }
                    try {
                        await db.addCallRecord({
                            serverName: target,
                            toolName,
                            requestTokens: inputTokens,
                            responseTokens: outputTokens,
                            totalTokens: inputTokens + outputTokens,
                            durationMs: Date.now() - start,
                            timestamp: new Date().toISOString(),
                        });
                    }
                    catch {
                        /* DB log failure is non-fatal */
                    }
                },
            });
            return;
        }
        const upstream = buildUpstreamUrl();
        relayToUpstream({
            upstream,
            method: clientReq.method || 'POST',
            headers: forwardHeaders(upstream, { 'content-length': String(Buffer.byteLength(rawBody)) }),
            body: rawBody,
            clientRes,
            timeoutMs: upstreamTimeoutMs,
            agent: upstreamAgent,
        });
    };
    if (inboundTls) {
        return https.createServer({ cert: inboundTls.cert, key: inboundTls.key }, handler);
    }
    return http.createServer(handler);
}
