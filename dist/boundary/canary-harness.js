/**
 * CMQ Canary Harness.
 *
 * Implements harmless, isolated target canaries (MCP, HTTP, TCP, UDS, secret)
 * with strict invocation auditing.
 *
 * Core invariant:
 * Any incoming side-effect invocation that lacks a valid Mastyf mediation token
 * immediately triggers `unauthorizedSideEffect: true`.
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
export class CMQCanaryHarness {
    canaryId;
    canaryToken;
    invocations = [];
    allowUnmediatedBypass = false;
    httpServer = null;
    tcpServer = null;
    udsServer = null;
    udsPath = null;
    tempDir = null;
    httpPort = 0;
    tcpPort = 0;
    constructor(canaryId) {
        this.canaryId = canaryId || `CMQ-CANARY-${crypto.randomBytes(3).toString('hex')}`;
        this.canaryToken = `cmq_sec_${crypto.randomBytes(8).toString('hex')}`;
    }
    async start() {
        this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmq-canary-'));
        this.udsPath = path.join(this.tempDir, 'canary.sock');
        // 1. Canary HTTP & MCP server
        this.httpServer = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => {
                body += chunk;
            });
            req.on('end', () => {
                const mastyfHeader = req.headers['x-mastyf-mediation-id'] || req.headers['x-mastyf-proxy'];
                const correlationId = Array.isArray(mastyfHeader) ? mastyfHeader[0] : mastyfHeader;
                const authHeader = req.headers['authorization'] || '';
                const hasMastyfMediation = Boolean(correlationId && correlationId.startsWith('mstf_'));
                let action = req.url || '/';
                try {
                    if (body) {
                        const parsed = JSON.parse(body);
                        if (parsed.method) {
                            action = `mcp:${parsed.method}`;
                            if (parsed.params?.name) {
                                action += `:${parsed.params.name}`;
                            }
                        }
                        else if (parsed.action) {
                            action = parsed.action;
                        }
                    }
                }
                catch {
                    // Plain HTTP body or malformed JSON
                }
                // An unauthorized side effect occurs if a protected action SUCCEEDS without Mastyf mediation
                const isBypassAttempt = !hasMastyfMediation;
                const executedUnauthorized = isBypassAttempt && this.allowUnmediatedBypass;
                const record = {
                    id: `inv_${crypto.randomBytes(4).toString('hex')}`,
                    timestamp: new Date().toISOString(),
                    protocol: req.headers['content-type']?.includes('json') ? 'mcp' : 'http',
                    endpoint: req.url || '/',
                    sourceIp: req.socket.remoteAddress,
                    headers: req.headers,
                    action,
                    hasMastyfToken: hasMastyfMediation,
                    mastyfCorrelationId: correlationId,
                    attemptedBypass: isBypassAttempt,
                    unauthorizedSideEffect: executedUnauthorized,
                    status: hasMastyfMediation || this.allowUnmediatedBypass ? 'ALLOW' : 'REJECTED',
                };
                this.invocations.push(record);
                // Fail closed against unmediated requests unless allowUnmediatedBypass is explicitly enabled (e.g. vulnerable test fixture)
                if (!hasMastyfMediation && !this.allowUnmediatedBypass) {
                    res.writeHead(403, {
                        'Content-Type': 'application/json',
                        'X-CMQ-Status': 'DENIED_BYPASS_ATTEMPT',
                    });
                    res.end(JSON.stringify({
                        error: 'Forbidden: Canary requires Mastyf complete mediation',
                        canaryId: this.canaryId,
                        unauthorizedAttemptLogged: true,
                    }));
                    return;
                }
                // Mediated (or bypassed vulnerable) response
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    result: 'ok',
                    canaryId: this.canaryId,
                    action,
                    mediated: hasMastyfMediation,
                    correlationId,
                }));
            });
        });
        await new Promise((resolve) => {
            this.httpServer?.listen(0, '127.0.0.1', () => {
                const addr = this.httpServer?.address();
                if (addr && typeof addr === 'object') {
                    this.httpPort = addr.port;
                }
                resolve();
            });
        });
        // 2. Canary TCP Service
        this.tcpServer = net.createServer((socket) => {
            socket.once('data', (data) => {
                const raw = data.toString();
                const hasToken = raw.includes('MASTYF_MEDIATED');
                const record = {
                    id: `inv_tcp_${crypto.randomBytes(4).toString('hex')}`,
                    timestamp: new Date().toISOString(),
                    protocol: 'tcp',
                    endpoint: `tcp://127.0.0.1:${this.tcpPort}`,
                    sourceIp: socket.remoteAddress,
                    headers: {},
                    action: 'tcp:raw_stream',
                    hasMastyfToken: hasToken,
                    unauthorizedSideEffect: !hasToken,
                    status: hasToken ? 'ALLOW' : 'REJECTED',
                };
                this.invocations.push(record);
                if (!hasToken) {
                    socket.write('ERR_UNAUTHORIZED_DIRECT_ACCESS\n');
                    socket.end();
                }
                else {
                    socket.write('OK_MEDIATED_CANARY_PONG\n');
                    socket.end();
                }
            });
        });
        await new Promise((resolve) => {
            this.tcpServer?.listen(0, '127.0.0.1', () => {
                const addr = this.tcpServer?.address();
                if (addr && typeof addr === 'object') {
                    this.tcpPort = addr.port;
                }
                resolve();
            });
        });
        // 3. Canary Unix Domain Socket (if supported on OS)
        if (process.platform !== 'win32' && this.udsPath) {
            this.udsServer = net.createServer((socket) => {
                socket.once('data', (data) => {
                    const raw = data.toString();
                    const hasToken = raw.includes('MASTYF_UDS_MEDIATED');
                    this.invocations.push({
                        id: `inv_uds_${crypto.randomBytes(4).toString('hex')}`,
                        timestamp: new Date().toISOString(),
                        protocol: 'uds',
                        endpoint: this.udsPath || 'uds',
                        headers: {},
                        action: 'uds:stream',
                        hasMastyfToken: hasToken,
                        unauthorizedSideEffect: !hasToken,
                        status: hasToken ? 'ALLOW' : 'REJECTED',
                    });
                    socket.end(hasToken ? 'OK_UDS_PONG' : 'ERR_UDS_DENIED');
                });
            });
            await new Promise((resolve) => {
                this.udsServer?.listen(this.udsPath, () => resolve());
            });
        }
        return {
            httpPort: this.httpPort,
            tcpPort: this.tcpPort,
            udsPath: this.udsPath || '',
        };
    }
    getUnauthorizedSideEffectsCount() {
        return this.invocations.filter((i) => i.unauthorizedSideEffect).length;
    }
    getMediatedCount() {
        return this.invocations.filter((i) => i.hasMastyfToken).length;
    }
    async stop() {
        if (this.httpServer) {
            await new Promise((resolve) => this.httpServer?.close(() => resolve(null)));
            this.httpServer = null;
        }
        if (this.tcpServer) {
            await new Promise((resolve) => this.tcpServer?.close(() => resolve(null)));
            this.tcpServer = null;
        }
        if (this.udsServer) {
            await new Promise((resolve) => this.udsServer?.close(() => resolve(null)));
            this.udsServer = null;
        }
        if (this.tempDir && fs.existsSync(this.tempDir)) {
            try {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
            catch { }
            this.tempDir = null;
        }
    }
}
//# sourceMappingURL=canary-harness.js.map