/**
 * Transport-specific denial shaping for target-authorization blocks.
 *
 * The guard itself lives once in `runMcpPrePipeline` and is covered directly in
 * `tests/security/resource-prompt-predispatch.test.ts`. What differs per
 * transport — and what can silently regress on its own — is how each transport
 * turns a `blocked` verdict into bytes on the wire.
 *
 * `id` is optional in the JSON-RPC schema, so a traversal `resources/read` that
 * omits it must still be refused. Because a request without an id is a
 * notification, the refusal must carry no response body; otherwise the proxy
 * would answer a message the client never asked to have answered, and — worse —
 * a transport that keyed enforcement off the presence of an id would forward
 * the traversal to the upstream server. These tests pin both halves per
 * transport: the id-less denial stays silent, the identified denial is answered.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { HttpProxyServer } from '../../src/proxy/http-proxy-server.js';
import { SseProxyServer } from '../../src/proxy/sse-proxy-server.js';
import { StreamableHttpProxyServer } from '../../src/proxy/streamable-http-proxy-server.js';
import { WebSocketProxyServer } from '../../src/proxy/websocket-proxy-server.js';
import { startMcpWsEchoFixture } from '../fixtures/start-mcp-echo-fixture.js';

const TRAVERSAL_URI = 'file:///app/../../etc/passwd';
const DEAD_UPSTREAM = 'http://127.0.0.1:9';

function allowPolicy(): PolicyEngine {
  return new PolicyEngine({
    version: '1.0',
    policy: { mode: 'block', default_action: 'allow', rules: [] },
  });
}

function traversalRead(withId: boolean): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    ...(withId ? { id: 7 } : {}),
    method: 'resources/read',
    params: { uri: TRAVERSAL_URI },
  };
}

function errorCode(body: unknown): number | undefined {
  return (body as { error?: { code?: number } } | undefined)?.error?.code;
}

describe('HTTP transport denial shaping', () => {
  let proxy: HttpProxyServer | null = null;

  beforeEach(() => {
    process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM = 'true';
  });

  afterEach(async () => {
    if (proxy) {
      await proxy.stop();
      proxy = null;
    }
    delete process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM;
  });

  function post(port: number, body: unknown): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        (res) => {
          let buf = '';
          res.on('data', (c) => {
            buf += c.toString();
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  it('refuses an id-less traversal resources/read with 204 and no body', async () => {
    proxy = new HttpProxyServer(DEAD_UPSTREAM, 'http-idless', allowPolicy(), undefined, undefined, 0);
    await proxy.start();

    const res = await post(proxy.getPort(), traversalRead(false));

    expect(res.status).toBe(204);
    expect(res.body).toBe('');
  });

  it('refuses an identified traversal resources/read with 403 and an error body', async () => {
    proxy = new HttpProxyServer(DEAD_UPSTREAM, 'http-id', allowPolicy(), undefined, undefined, 0);
    await proxy.start();

    const res = await post(proxy.getPort(), traversalRead(true));

    expect(res.status).toBe(403);
    const parsed = JSON.parse(res.body) as { id?: number; error?: { code?: number } };
    expect(parsed.id).toBe(7);
    expect(parsed.error?.code).toBe(-32001);
  });
});

describe('SSE transport denial shaping', () => {
  let db: HistoryDatabase;

  beforeEach(async () => {
    process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM = 'true';
    db = new HistoryDatabase(':memory:');
    await db.initialize();
  });

  afterEach(() => {
    delete process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM;
    db.close();
  });

  it('returns no body for an id-less traversal resources/read', async () => {
    const proxy = new SseProxyServer({
      upstreamUrl: `${DEAD_UPSTREAM}/sse`,
      serverName: 'sse-idless',
      policy: allowPolicy(),
      db,
    });

    const result = await proxy.interceptAndForward(traversalRead(false));

    // `undefined` is the SSE transport's "nothing to write": no `data:` event is
    // emitted, so the client receives no response to a message it sent without an id.
    expect(result).toBeUndefined();
  });

  it('returns an error body for an identified traversal resources/read', async () => {
    const proxy = new SseProxyServer({
      upstreamUrl: `${DEAD_UPSTREAM}/sse`,
      serverName: 'sse-id',
      policy: allowPolicy(),
      db,
    });

    const result = await proxy.interceptAndForward(traversalRead(true));

    expect(errorCode(result)).toBe(-32001);
  });
});

describe('Streamable HTTP transport denial shaping', () => {
  let proxy: StreamableHttpProxyServer;

  beforeEach(() => {
    process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM = 'true';
    proxy = new StreamableHttpProxyServer({
      listenPort: 0,
      upstreamBaseUrl: DEAD_UPSTREAM,
      serverName: 'streamable-shape',
      policy: allowPolicy(),
    });
  });

  afterEach(() => {
    delete process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM;
  });

  function processMessage(body: Record<string, unknown>): Promise<unknown> {
    return (proxy as unknown as {
      processMessage: (m: Record<string, unknown>, r: unknown) => Promise<unknown>;
    }).processMessage(body, { headers: {} });
  }

  it('yields undefined for an id-less traversal resources/read so the batch loop drops it', async () => {
    const result = await processMessage(traversalRead(false));
    // Serialising this as `null` would emit a JSON-RPC response to a notification.
    expect(result).toBeUndefined();
  });

  it('yields an error body for an identified traversal resources/read', async () => {
    const result = await processMessage(traversalRead(true));
    expect(errorCode(result)).toBe(-32001);
  });
});

describe('WebSocket transport denial shaping', () => {
  let upstream: Awaited<ReturnType<typeof startMcpWsEchoFixture>>;
  let proxy: WebSocketProxyServer;

  beforeEach(async () => {
    process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM = 'true';
    upstream = await startMcpWsEchoFixture();
    proxy = new WebSocketProxyServer({
      listenPort: 0,
      upstreamWsUrl: `ws://127.0.0.1:${upstream.port}`,
      serverName: 'ws-shape',
      policy: allowPolicy(),
    });
    await proxy.start();
  });

  afterEach(async () => {
    await proxy?.stop();
    await upstream?.close();
    delete process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM;
  });

  async function connect(): Promise<WebSocket> {
    const client = new WebSocket(`ws://127.0.0.1:${proxy.getListenPort()}`);
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });
    // The proxy wires the client's `message` listener inside the *upstream*
    // socket's `open` handler, so a message sent before that is silently
    // unmediated — which would make an "expect silence" assertion vacuous.
    await new Promise((r) => setTimeout(r, 100));
    return client;
  }

  it('sends no frame for an id-less traversal resources/read', async () => {
    const client = await connect();
    try {
      const received: string[] = [];
      client.on('message', (data) => received.push(String(data)));

      client.send(JSON.stringify(traversalRead(false)));
      // Give the round trip a chance to (wrongly) produce a frame.
      await new Promise((r) => setTimeout(r, 400));

      expect(received).toEqual([]);
    } finally {
      client.close();
    }
  });

  it('sends an error frame for an identified traversal resources/read', async () => {
    const client = await connect();
    try {
      const received = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no frame received')), 4000);
        client.once('message', (data) => {
          clearTimeout(timer);
          resolve(String(data));
        });
      });

      client.send(JSON.stringify(traversalRead(true)));
      const frame = JSON.parse(await received) as { id?: number; error?: { code?: number } };

      expect(frame.id).toBe(7);
      expect(frame.error?.code).toBe(-32001);
    } finally {
      client.close();
    }
  });
});
