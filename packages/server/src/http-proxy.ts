/**
 * HTTP/SSE Transparent Proxy for Cost Auditing (v2.1).
 *
 * Intercepts HTTP requests to upstream MCP servers, inspects JSON-RPC tools/call
 * payloads, runs token counting and policy evaluation, then forwards to the target.
 */
import * as http from 'http';
import { URL } from 'url';

// Lightweight injection-compatible interfaces (no runtime dependency on core)
interface TokenCounterLike { count(text: string): number; }
interface PolicyEngineLike { evaluate(c: any): { action: string; rule: string; reason: string }; }
interface DatabaseLike { addCallRecord(r: any): Promise<void>; }

export function createHttpProxy(
  targetUrl: string,
  policyEngine: PolicyEngineLike | null,
  db: DatabaseLike,
  tokenCounter: TokenCounterLike,
): http.Server {
  const target = targetUrl.replace(/\/$/, '');

  const server = http.createServer(async (clientReq, clientRes) => {
    const start = Date.now();
    // Only intercept POST (tools/call)
    if (clientReq.method !== 'POST') {
      const upstream = new URL(target + (clientReq.url ?? '/'));
      const opts: http.RequestOptions = {
        hostname: upstream.hostname, port: upstream.port || 80,
        path: upstream.pathname + upstream.search, method: clientReq.method,
        headers: { ...clientReq.headers, host: upstream.hostname },
      };
      const upstreamReq = http.request(opts, upstreamRes => {
        clientRes.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
      });
      upstreamReq.on('error', () => { if (!clientRes.headersSent) clientRes.writeHead(502).end(); });
      clientReq.pipe(upstreamReq);
      return;
    }

    // Buffer body
    const chunks: Buffer[] = [];
    for await (const chunk of clientReq) chunks.push(chunk as Buffer);
    const rawBody = Buffer.concat(chunks).toString();

    let parsed: any;
    try { parsed = JSON.parse(rawBody); } catch {
      // Not JSON — forward
      const upstream = new URL(target + (clientReq.url ?? '/'));
      const opts: http.RequestOptions = {
        hostname: upstream.hostname, port: upstream.port || 80,
        path: upstream.pathname + upstream.search, method: 'POST',
        headers: { ...clientReq.headers, host: upstream.hostname, 'content-length': String(rawBody.length) },
      };
      const upstreamReq = http.request(opts, upstreamRes => {
        clientRes.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
      });
      upstreamReq.on('error', () => { if (!clientRes.headersSent) clientRes.writeHead(502).end(); });
      upstreamReq.write(rawBody);
      upstreamReq.end();
      return;
    }

    // tools/call
    if (parsed.method === 'tools/call') {
      const toolName = parsed.params?.name || 'unknown';
      const inputTokens = tokenCounter.count(rawBody);

      // Policy check
      if (policyEngine) {
        const policyResult = policyEngine.evaluate({
          toolName, arguments: parsed.params?.arguments || {},
          serverName: target, requestTokens: inputTokens,
          timestamp: new Date().toISOString(),
        });
        if (policyResult.action === 'block') {
          clientRes.writeHead(403, { 'Content-Type': 'application/json' });
          clientRes.end(JSON.stringify({
            jsonrpc: '2.0', id: parsed.id,
            error: { code: -32000, message: `Blocked: ${policyResult.reason}`, data: { rule: policyResult.rule } },
          }));
          return;
        }
      }

      // Forward
      const upstream = new URL(target + (clientReq.url ?? '/'));
      const opts: http.RequestOptions = {
        hostname: upstream.hostname, port: upstream.port || 80,
        path: upstream.pathname + upstream.search, method: 'POST',
        headers: { ...clientReq.headers, host: upstream.hostname, 'content-length': String(rawBody.length) },
      };
      const upstreamReq = http.request(opts, async (upstreamRes) => {
        const respChunks: Buffer[] = [];
        upstreamRes.on('data', (chunk: Buffer) => respChunks.push(chunk));
        upstreamRes.on('end', async () => {
          const responseBody = Buffer.concat(respChunks).toString();
          let outputTokens = 0;
          try {
            const responseJson = JSON.parse(responseBody);
            if (responseJson.result?.content) {
              outputTokens = tokenCounter.count(
                (responseJson.result.content as any[]).map(c => c.text || '').join('')
              );
            }
          } catch { outputTokens = Math.round(responseBody.length * 0.25); }

          clientRes.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
          clientRes.end(responseBody);

          try {
            await db.addCallRecord({
              serverName: target, toolName,
              requestTokens: inputTokens, responseTokens: outputTokens,
              totalTokens: inputTokens + outputTokens, durationMs: Date.now() - start,
              timestamp: new Date().toISOString(),
            });
          } catch { /* DB log failure is non-fatal */ }
        });
      });
      upstreamReq.on('error', () => { if (!clientRes.headersSent) clientRes.writeHead(502).end(); });
      upstreamReq.write(rawBody);
      upstreamReq.end();
    } else {
      // Forward non-tools/call
      const upstream = new URL(target + (clientReq.url ?? '/'));
      const opts: http.RequestOptions = {
        hostname: upstream.hostname, port: upstream.port || 80,
        path: upstream.pathname + upstream.search, method: 'POST',
        headers: { ...clientReq.headers, host: upstream.hostname, 'content-length': String(rawBody.length) },
      };
      const upstreamReq = http.request(opts, upstreamRes => {
        clientRes.writeHead(upstreamRes.statusCode ?? 200, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
      });
      upstreamReq.on('error', () => { if (!clientRes.headersSent) clientRes.writeHead(502).end(); });
      upstreamReq.write(rawBody);
      upstreamReq.end();
    }
  });

  return server;
}