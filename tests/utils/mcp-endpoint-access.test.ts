/**
 * GHSA-vr58-8mmm-pg6c: who may reach the MCP relay.
 * Real HTTP servers, forged Host/Origin headers, as in the advisory's proof of concept.
 */
import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardAuth } from '../../src/auth/dashboard-auth.js';
import { mountMcpEndpoint } from '../../src/utils/mcp-http-bridge.js';
import { LocalIngressServer } from '../../src/proxy/local-ingress-server.js';
import { isLoopbackHostHeader, isCrossSiteBrowserOrigin } from '../../src/utils/local-request-guard.js';
import type { ProxyManager } from '../../src/proxy/proxy-manager.js';

const API_KEY = 'a-real-configured-key';
const INIT = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' });

/** A proxy that records what reached it and answers on stdout, as the stdio proxy does. */
function recordingManager() {
  const reached: string[] = [];
  const proxy = {
    async handleClientInput(raw: string) {
      reached.push(raw);
      const msg = JSON.parse(raw);
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: 'live tool result' } }) + '\n');
    },
  };
  return { manager: { getProxies: () => [proxy] } as unknown as ProxyManager, reached };
}

function post(port: number, path: string, headers: Record<string, string>, body = INIT) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const servers: Server[] = [];
const ingresses: LocalIngressServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
  await Promise.all(ingresses.splice(0).map((i) => i.stop()));
});

/** The dashboard as cli.ts runs it: an auth-checking server, then the /mcp bridge mounted on top. */
async function dashboard(auth: DashboardAuth | undefined) {
  const { manager, reached } = recordingManager();
  const server = http.createServer((req, res) => {
    const result = (auth ?? new DashboardAuth({ enabled: true, apiKey: API_KEY })).authenticate({
      url: req.url,
      headers: req.headers,
      method: req.method,
    });
    res.writeHead(result.authenticated ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ fellThrough: true }));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  mountMcpEndpoint(server, '/mcp', manager, auth as DashboardAuth);
  return { port: (server.address() as AddressInfo).port, reached };
}

describe('dashboard /mcp bridge', () => {
  it('rejects a request with no credentials when auth is on', async () => {
    const { port, reached } = await dashboard(new DashboardAuth({ enabled: true, apiKey: API_KEY }));
    const r = await post(port, '/mcp', {});
    expect(r.status).toBe(401);
    expect(reached).toHaveLength(0);
  });

  it('relays a request that carries the API key', async () => {
    const { port, reached } = await dashboard(new DashboardAuth({ enabled: true, apiKey: API_KEY }));
    const r = await post(port, '/mcp', { Authorization: `Bearer ${API_KEY}` });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).result.ok).toBe('live tool result');
    expect(reached).toHaveLength(1);
  });

  it('never relays when it was mounted without an auth checker', async () => {
    const { port, reached } = await dashboard(undefined);
    const r = await post(port, '/mcp', { Host: 'attacker.example', Origin: 'http://attacker.example' });
    expect(reached).toHaveLength(0);
    expect(r.status).not.toBe(200);
  });

  it('with auth turned off, refuses a rebound Host (DNS rebinding)', async () => {
    const { port, reached } = await dashboard(new DashboardAuth({ enabled: false }));
    const r = await post(port, '/mcp', { Host: 'attacker.example' });
    expect(r.status).toBe(403);
    expect(reached).toHaveLength(0);
  });

  it('with auth turned off, refuses a cross-site browser request to 127.0.0.1', async () => {
    const { port, reached } = await dashboard(new DashboardAuth({ enabled: false }));
    const r = await post(port, '/mcp', { Host: `127.0.0.1:${port}`, Origin: 'https://attacker.example' });
    expect(r.status).toBe(403);
    expect(reached).toHaveLength(0);
  });

  it('with auth turned off, still serves a local non-browser client', async () => {
    const { port, reached } = await dashboard(new DashboardAuth({ enabled: false }));
    const r = await post(port, '/mcp', { Host: `127.0.0.1:${port}` });
    expect(r.status).toBe(200);
    expect(reached).toHaveLength(1);
  });

  it('refuses a cross-site browser origin even with a valid key', async () => {
    const { port, reached } = await dashboard(new DashboardAuth({ enabled: true, apiKey: API_KEY }));
    const r = await post(port, '/mcp', { Authorization: `Bearer ${API_KEY}`, Origin: 'https://attacker.example' });
    expect(r.status).toBe(403);
    expect(reached).toHaveLength(0);
  });
});

async function ingress() {
  const { manager, reached } = recordingManager();
  const server = new LocalIngressServer({ listenPort: 0, serverName: 'test', proxyManager: manager });
  ingresses.push(server);
  const port = await server.start();
  return { port, reached };
}

describe('Fleet Hub local ingress', () => {
  it('refuses a rebound Host (the advisory proof of concept)', async () => {
    const { port, reached } = await ingress();
    const r = await post(port, '/mcp', { Host: 'attacker.example', Origin: 'http://attacker.example' });
    expect(r.status).toBe(403);
    expect(reached).toHaveLength(0);
  });

  it('refuses a cross-site browser request sent to 127.0.0.1', async () => {
    const { port, reached } = await ingress();
    const r = await post(port, '/mcp', { Host: `127.0.0.1:${port}`, Origin: 'https://attacker.example' });
    expect(r.status).toBe(403);
    expect(reached).toHaveLength(0);
  });

  it('refuses the opaque "null" origin (sandboxed iframes, data: pages)', async () => {
    const { port, reached } = await ingress();
    const r = await post(port, '/mcp', { Host: `127.0.0.1:${port}`, Origin: 'null' });
    expect(r.status).toBe(403);
    expect(reached).toHaveLength(0);
  });

  it('serves an IDE connecting to 127.0.0.1 or localhost', async () => {
    const { port, reached } = await ingress();
    expect((await post(port, '/mcp', { Host: `127.0.0.1:${port}` })).status).toBe(200);
    expect((await post(port, '/mcp', { Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).status).toBe(200);
    expect((await post(port, '/mcp', { Host: `127.0.0.1:${port}`, Origin: 'vscode-file://vscode-app' })).status).toBe(200);
    expect(reached).toHaveLength(3);
  });
});

describe('local request guard', () => {
  it.each([
    ['127.0.0.1', true], ['127.0.0.1:19109', true], ['127.5.6.7:80', true], ['localhost', true],
    ['LOCALHOST:4000', true], ['[::1]', true], ['[::1]:4000', true],
    ['attacker.example', false], ['attacker.example:19109', false], ['127.0.0.1.attacker.example', false],
    ['localhost.attacker.example:80', false], ['0.0.0.0:4000', false], ['192.168.1.5:4000', false], ['', false],
  ])('Host %s → loopback %s', (host, expected) => {
    expect(isLoopbackHostHeader(host)).toBe(expected);
  });

  it('treats a missing Host as not loopback', () => {
    expect(isLoopbackHostHeader(undefined)).toBe(false);
  });

  it.each([
    [undefined, false], ['http://127.0.0.1:3000', false], ['http://localhost:4000', false], ['http://[::1]:4000', false],
    ['vscode-file://vscode-app', false], ['vscode-webview://abc', false],
    ['null', true], ['https://attacker.example', true], ['http://127.0.0.1.attacker.example', true], ['not a url', true],
  ])('Origin %s → cross-site %s', (origin, expected) => {
    expect(isCrossSiteBrowserOrigin(origin)).toBe(expected);
  });
});
