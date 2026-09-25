import { Logger } from './logger.js';
import { RequestIdLock } from './request-id-lock.js';
const mcpSerialQueue = new RequestIdLock();
export async function relayMcpHttpRequest(req, res, proxyManager) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf-8').trim();
    if (!body) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Empty request body' } }));
        return;
    }
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
    }
    const proxies = proxyManager.getProxies();
    if (proxies.length === 0) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id ?? null, error: { code: -32003, message: 'No proxy available' } }));
        return;
    }
    const proxy = proxies[0];
    const requestId = parsed.id;
    await mcpSerialQueue.enqueue(undefined, async () => {
        const originalWrite = process.stdout.write.bind(process.stdout);
        let capturedResponse = null;
        let resolvePromise = null;
        const responsePromise = new Promise((resolve) => {
            resolvePromise = resolve;
        });
        const interceptedWrite = (chunk) => {
            const str = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
            const lines = str.split('\n').filter((l) => l.trim());
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.id === requestId || msg.id == requestId) {
                        capturedResponse = line;
                        if (resolvePromise)
                            resolvePromise(line);
                        break;
                    }
                }
                catch {
                    /* not json */
                }
            }
            return true;
        };
        const timeoutMs = 15000;
        try {
            process.stdout.write = interceptedWrite;
            void proxy.handleClientInput(body);
            const result = await Promise.race([
                responsePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs)),
            ]);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(result);
        }
        catch {
            if (capturedResponse) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(capturedResponse);
            }
            else {
                Logger.warn(`[mcp-relay] Request ${JSON.stringify(requestId)} timed out after ${timeoutMs}ms`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: requestId ?? null,
                    error: { code: -32003, message: 'No response from proxy' },
                }));
            }
        }
        finally {
            process.stdout.write = originalWrite;
        }
    });
}
//# sourceMappingURL=mcp-http-relay.js.map