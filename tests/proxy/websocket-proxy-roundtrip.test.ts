import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import { WebSocketProxyServer } from '../../src/proxy/websocket-proxy-server.js';
import { startMcpWsEchoFixture } from '../fixtures/start-mcp-echo-fixture.js';

async function openWs(url: string): Promise<WebSocket> {
  const client = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    client.once('open', () => resolve());
    client.once('error', reject);
  });
  await new Promise((r) => setTimeout(r, 50));
  return client;
}

async function sendToolsCall(
  client: WebSocket,
  id: number,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    client.once('message', (data) => {
      clearTimeout(timer);
      resolve(String(data));
    });
    client.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
    );
  });
}

describe('WebSocketProxyServer round-trip', () => {
  const prevMode = process.env.GUARDIAN_RESPONSE_DLP_MODE;
  let upstream: Awaited<ReturnType<typeof startMcpWsEchoFixture>>;
  let upstreamPort = 0;
  let proxy: WebSocketProxyServer;
  let proxyPort = 0;

  beforeEach(async () => {
    process.env.GUARDIAN_RESPONSE_DLP_MODE = 'redact';

    upstream = await startMcpWsEchoFixture();
    upstreamPort = upstream.port;

    const policy = new PolicyEngine({
      version: '1.0',
      policy: { mode: 'block', default_action: 'allow', rules: [] },
    });
    proxy = new WebSocketProxyServer({
      listenPort: 0,
      upstreamWsUrl: `ws://127.0.0.1:${upstreamPort}`,
      serverName: 'ws-rt',
      policy,
    });
    await proxy.start();
    proxyPort = proxy.getListenPort();
    expect(proxyPort).toBeGreaterThan(0);
  });

  afterEach(async () => {
    if (prevMode) process.env.GUARDIAN_RESPONSE_DLP_MODE = prevMode;
    else delete process.env.GUARDIAN_RESPONSE_DLP_MODE;
    await proxy.stop();
    await upstream.close();
  });

  it(
    'redacts sensitive content echoed from upstream through proxy',
    async () => {
      const client = await openWs(`ws://127.0.0.1:${proxyPort}`);
      const response = await sendToolsCall(client, 99, 'echo', {
        note: 'patient ssn 123-45-6789',
      });
      client.close();
      const msg = JSON.parse(response) as { result?: { content?: { text?: string }[] } };
      expect(msg.result).toBeDefined();
      expect(JSON.stringify(msg.result)).not.toContain('123-45-6789');
    },
    15_000,
  );

  it(
    'blocks tools/call when policy denies the tool',
    async () => {
      const denyPolicy = new PolicyEngine({
        version: '1.0',
        policy: {
          mode: 'block',
          default_action: 'allow',
          rules: [{ name: 'deny-eval', action: 'block', tools: { deny: ['eval'] } }],
        },
      });
      const denyProxy = new WebSocketProxyServer({
        listenPort: 0,
        upstreamWsUrl: `ws://127.0.0.1:${upstreamPort}`,
        serverName: 'ws-deny',
        policy: denyPolicy,
      });
      await denyProxy.start();
      const client = await openWs(`ws://127.0.0.1:${denyProxy.getListenPort()}`);
      const response = await sendToolsCall(client, 1, 'eval');
      client.close();
      await denyProxy.stop();

      const msg = JSON.parse(response) as { error?: { code?: number; message?: string } };
      expect(msg.error?.code).toBe(-32001);
      expect(String(msg.error?.message)).toMatch(/blocked|policy/i);
    },
    15_000,
  );

  it(
    'blocks tool response with sensitive echoed content in block DLP mode',
    async () => {
      process.env.GUARDIAN_RESPONSE_DLP_MODE = 'block';
      const client = await openWs(`ws://127.0.0.1:${proxyPort}`);
      const response = await sendToolsCall(client, 12, 'echo', {
        note: 'patient ssn 123-45-6789',
      });
      client.close();
      const msg = JSON.parse(response) as { error?: { code?: number; message?: string } };
      expect(msg.error?.code).toBe(-32002);
      expect(String(msg.error?.message)).toMatch(/blocked/i);
    },
    15_000,
  );

  it(
    'blocks tools/call when rug-pull flag is set',
    async () => {
      (proxy as any).rugPullState.blocked = true;
      const client = await openWs(`ws://127.0.0.1:${proxyPort}`);
      const response = await sendToolsCall(client, 2, 'echo');
      client.close();
      const msg = JSON.parse(response) as { error?: { code?: number; message?: string } };
      expect(String(msg.error?.message)).toContain('rug-pull');
    },
    15_000,
  );
});
