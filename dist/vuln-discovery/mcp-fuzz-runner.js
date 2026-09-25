/**
 * Live MCP tool-fuzz runner — tools/list → generateFuzzPayloads → tools/call → findings.
 *
 * Default path for novel/runtime discovery (not supply-chain advisories).
 * Stdio local servers only unless URL is allowlisted.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { Logger } from '../utils/logger.js';
import { isTargetAuthorized, isVulnDiscoveryEnabled, auditProbe, checkProbeRateLimit } from './auth.js';
import { generateFuzzPayloads, findingFromFuzzResult, getFuzzDepthFromEnv, } from './mcp-tool-fuzzer.js';
import { scanToolResponse } from './response-scanner.js';
import { sortToolsByLiveHotness } from './live-traffic-stats.js';
function envInt(name, fallback) {
    const n = parseInt(process.env[name] || '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
function canFuzzServer(server) {
    if (!isVulnDiscoveryEnabled() && process.env.MASTYF_AI_VULN_DISCOVERY_FORCE !== 'true') {
        return { ok: false, reason: 'vuln discovery disabled' };
    }
    if (server.transport === 'stdio' || (!server.url && server.command)) {
        return { ok: true, reason: 'local-stdio' };
    }
    if (server.url) {
        return isTargetAuthorized(server.url);
    }
    return { ok: false, reason: 'no command or allowlisted URL' };
}
/**
 * HTTP/JSON-RPC transport against a Mastyf proxy or streamable MCP URL.
 * Proxy blocks surface as blockedByProxy=true.
 */
export async function openProxyHttpFuzzTransport(baseUrl, opts) {
    const root = baseUrl.replace(/\/$/, '');
    const timeoutMs = opts?.timeoutMs ?? envInt('MASTYF_AI_VULN_FUZZ_CALL_TIMEOUT_MS', 8000);
    async function rpc(method, params) {
        const id = randomUUID();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetch(root, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }),
                signal: ctrl.signal,
            });
            const text = await res.text();
            let msg;
            try {
                msg = JSON.parse(text);
            }
            catch {
                throw new Error(`non-json proxy response: ${text.slice(0, 200)}`);
            }
            return msg;
        }
        finally {
            clearTimeout(timer);
        }
    }
    // Best-effort initialize
    try {
        await rpc('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'mastyf-ai-vuln-fuzz-proxy', version: '1.0.0' },
        });
        await fetch(root, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        }).catch(() => undefined);
    }
    catch {
        /* some proxies accept tools/list without handshake */
    }
    return {
        async listTools() {
            const msg = await rpc('tools/list', {});
            if (msg.error)
                throw new Error(msg.error.message || 'tools/list failed');
            const tools = msg.result
                ?.tools || [];
            return tools.map((t) => ({
                name: t.name || 'unnamed',
                description: t.description,
                inputSchema: t.inputSchema,
            }));
        },
        async callTool(name, args) {
            try {
                const msg = await rpc('tools/call', { name, arguments: args });
                if (msg.error) {
                    const blocked = msg.error.code === -32001
                        || msg.error.code === -32002
                        || /blocked by mastyf/i.test(msg.error.message || '');
                    return {
                        ok: false,
                        blockedByProxy: blocked,
                        error: msg.error.message,
                    };
                }
                return { ok: true, result: msg.result, blockedByProxy: false };
            }
            catch (err) {
                return {
                    ok: false,
                    crashed: true,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    };
}
function wantViaProxy(opts) {
    return (opts.viaProxy === true
        || process.env.MASTYF_AI_VULN_FUZZ_VIA_PROXY === 'true');
}
/**
 * Stdio JSON-RPC session for fuzz calls.
 */
export async function openStdioFuzzTransport(server) {
    if (!server.command) {
        throw new Error(`Server ${server.name} has no command for stdio fuzz`);
    }
    const child = spawn(server.command, server.args || [], {
        env: { ...process.env, ...(server.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pending = new Map();
    let crashed = false;
    let crashReason = '';
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
        const t = line.trim();
        if (!t || t[0] !== '{')
            return;
        try {
            const msg = JSON.parse(t);
            if (msg.id === undefined)
                return;
            const id = String(msg.id);
            const wait = pending.get(id);
            if (!wait)
                return;
            clearTimeout(wait.timer);
            pending.delete(id);
            wait.resolve(msg);
        }
        catch {
            /* ignore non-json */
        }
    });
    child.stderr?.on('data', (d) => {
        Logger.debug(`[vuln-fuzz:${server.name}] ${d.toString().slice(0, 200)}`);
    });
    child.on('exit', (code, signal) => {
        crashed = true;
        crashReason = `exited code=${code} signal=${signal}`;
        for (const [, w] of pending) {
            clearTimeout(w.timer);
            w.reject(new Error(crashReason));
        }
        pending.clear();
    });
    child.on('error', (err) => {
        crashed = true;
        crashReason = err.message;
    });
    const defaultTimeout = envInt('MASTYF_AI_VULN_FUZZ_CALL_TIMEOUT_MS', 8000);
    function rpc(method, params, timeoutMs = defaultTimeout) {
        return new Promise((resolve, reject) => {
            if (crashed) {
                reject(new Error(crashReason || 'process crashed'));
                return;
            }
            if (!child.stdin?.writable) {
                reject(new Error('stdin closed'));
                return;
            }
            const id = randomUUID();
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`RPC timeout ${method}`));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n');
        });
    }
    // Handshake
    await rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mastyf-ai-vuln-fuzz', version: '1.0.0' },
    });
    try {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    }
    catch {
        /* ignore */
    }
    return {
        async listTools() {
            const msg = (await rpc('tools/list', {}));
            if (msg.error)
                throw new Error(msg.error.message || 'tools/list failed');
            const tools = msg.result?.tools || [];
            return tools.map((t) => ({
                name: t.name || 'unnamed',
                description: t.description,
                inputSchema: t.inputSchema,
            }));
        },
        async callTool(name, args) {
            if (crashed) {
                return { ok: false, crashed: true, error: crashReason };
            }
            try {
                const msg = (await rpc('tools/call', { name, arguments: args }));
                if (msg.error) {
                    const blocked = msg.error.code === -32001
                        || msg.error.code === -32002
                        || /blocked by mastyf/i.test(msg.error.message || '');
                    return {
                        ok: false,
                        blockedByProxy: blocked,
                        error: msg.error.message,
                        result: msg.error,
                    };
                }
                return { ok: true, result: msg.result, blockedByProxy: false };
            }
            catch (err) {
                return {
                    ok: false,
                    crashed: crashed || /exited|EPIPE|stdin/i.test(String(err)),
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
        async close() {
            for (const [, w] of pending) {
                clearTimeout(w.timer);
                w.reject(new Error('closed'));
            }
            pending.clear();
            rl.close();
            try {
                child.kill('SIGTERM');
            }
            catch {
                /* ignore */
            }
        },
    };
}
/**
 * Fuzz one MCP server: list tools, mutate args, call, classify findings.
 */
export async function fuzzServerTools(server, opts = {}) {
    const findings = [];
    const errors = [];
    let toolsFuzzed = 0;
    let callsMade = 0;
    const auth = canFuzzServer(server);
    if (!auth.ok) {
        return { findings, toolsFuzzed: 0, callsMade: 0, errors: [`skip:${server.name}:${auth.reason}`] };
    }
    const rate = checkProbeRateLimit();
    if (!rate.ok) {
        return { findings, toolsFuzzed: 0, callsMade: 0, errors: [`rate-limit:${server.name}`] };
    }
    auditProbe({
        action: 'mcp-fuzz',
        target: server.name,
        authorized: true,
        detail: auth.reason,
    });
    const maxTools = opts.maxTools ?? envInt('MASTYF_AI_VULN_FUZZ_MAX_TOOLS', 8);
    const maxPayloads = opts.maxPayloadsPerTool ?? envInt('MASTYF_AI_VULN_FUZZ_MAX_PAYLOADS_PER_TOOL', 6);
    const depth = getFuzzDepthFromEnv();
    let transport = opts.transport;
    let owned = false;
    if (!transport) {
        const viaProxy = wantViaProxy(opts);
        const proxyUrl = opts.proxyBaseUrl || server.url;
        if (viaProxy && proxyUrl) {
            const authUrl = isTargetAuthorized(proxyUrl);
            if (!authUrl.ok && process.env.MASTYF_AI_VULN_DISCOVERY_FORCE !== 'true') {
                return {
                    findings,
                    toolsFuzzed: 0,
                    callsMade: 0,
                    errors: [`proxy-not-authorized:${server.name}:${authUrl.reason}`],
                };
            }
            try {
                transport = await openProxyHttpFuzzTransport(proxyUrl, {
                    timeoutMs: opts.callTimeoutMs,
                });
                owned = true;
            }
            catch (err) {
                return {
                    findings,
                    toolsFuzzed: 0,
                    callsMade: 0,
                    errors: [`proxy-transport:${server.name}:${err instanceof Error ? err.message : String(err)}`],
                };
            }
        }
        else if (!(server.command || server.url)) {
            return { findings, toolsFuzzed: 0, callsMade: 0, errors: [`no-transport:${server.name}`] };
        }
        else if (!server.command) {
            return {
                findings,
                toolsFuzzed: 0,
                callsMade: 0,
                errors: [`sse-fuzz-not-implemented:${server.name} (set viaProxy / MASTYF_AI_VULN_FUZZ_VIA_PROXY)`],
            };
        }
        else {
            try {
                transport = await openStdioFuzzTransport(server);
                owned = true;
            }
            catch (err) {
                return {
                    findings,
                    toolsFuzzed: 0,
                    callsMade: 0,
                    errors: [`spawn:${server.name}:${err instanceof Error ? err.message : String(err)}`],
                };
            }
        }
    }
    try {
        const listed = await transport.listTools();
        const tools = sortToolsByLiveHotness(server.name, listed).slice(0, maxTools);
        for (const tool of tools) {
            toolsFuzzed++;
            const payloads = generateFuzzPayloads(tool.inputSchema, depth).slice(0, maxPayloads);
            for (const args of payloads) {
                const t0 = Date.now();
                const call = await transport.callTool(tool.name, args);
                callsMade++;
                const durationMs = Date.now() - t0;
                const excerpt = call.result != null
                    ? typeof call.result === 'string'
                        ? call.result.slice(0, 400)
                        : JSON.stringify(call.result).slice(0, 400)
                    : call.error?.slice(0, 400);
                const fuzzResult = {
                    toolName: tool.name,
                    args,
                    ok: !!call.ok,
                    blockedByProxy: call.blockedByProxy
                        ?? opts.blockedByProxyDefault
                        ?? false,
                    upstreamError: call.error,
                    crashed: call.crashed,
                    durationMs,
                    responseExcerpt: excerpt,
                };
                const fuzzFinding = findingFromFuzzResult(server.name, fuzzResult);
                if (fuzzFinding)
                    findings.push(fuzzFinding);
                if (call.ok && call.result != null) {
                    const scanned = scanToolResponse({
                        serverName: server.name,
                        toolName: tool.name,
                        result: call.result,
                        createFindings: true,
                    });
                    findings.push(...scanned.findings);
                }
            }
        }
    }
    catch (err) {
        errors.push(`fuzz:${server.name}:${err instanceof Error ? err.message : String(err)}`);
    }
    finally {
        if (owned && transport.close) {
            try {
                await transport.close();
            }
            catch {
                /* ignore */
            }
        }
    }
    Logger.info(`[vuln-fuzz] ${server.name}: tools=${toolsFuzzed} calls=${callsMade} findings=${findings.length}`);
    return { findings, toolsFuzzed, callsMade, errors };
}
/** Fuzz all configured servers (stdio preferred; URL via proxy when viaProxy). */
export async function fuzzMcpServers(servers, opts) {
    const merged = {
        findings: [],
        toolsFuzzed: 0,
        callsMade: 0,
        errors: [],
    };
    for (const server of servers) {
        const r = await fuzzServerTools(server, opts);
        merged.findings.push(...r.findings);
        merged.toolsFuzzed += r.toolsFuzzed;
        merged.callsMade += r.callsMade;
        merged.errors.push(...r.errors);
    }
    return merged;
}
//# sourceMappingURL=mcp-fuzz-runner.js.map