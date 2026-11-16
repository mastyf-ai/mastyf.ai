import { createServer } from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli';

const FAKE_MCP = join(__dirname, 'fixtures', 'fake-mcp.mjs');
const TOKEN = 'k'.repeat(43);

function io() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (d) => (out += d));
  stderr.on('data', (d) => (err += d));
  return { stdin, stdout, stderr, env: { MASTYF_CHECK_TOKEN: TOKEN }, out: () => out, err: () => err };
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

describe('mastyf-check --help', () => {
  it('lists the commands', async () => {
    const t = io();
    const r = await run(['--help'], t);
    expect(r.code).toBe(0);
    for (const word of ['serve', 'proxy', 'test']) expect(t.out()).toContain(word);
  });
});

describe('mastyf-check serve', () => {
  it('answers /v1/health, and a second one on the same port says the port is in use', async () => {
    const port = await freePort();
    const first = await run(['serve', '--port', String(port)], io());
    try {
      expect(first.code).toBe(0);
      const health = await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json();
      expect(health).toMatchObject({ status: 'ready', tier: 'free' });
      const t = io();
      const second = await run(['serve', '--port', String(port)], t);
      expect(second.code).not.toBe(0);
      expect(t.err()).toContain(`port ${port} is in use`);
    } finally {
      await first.close?.();
    }
  });
});

describe('mastyf-check test', () => {
  it('prints the verdict; exit 2 on block, 0 on allow', async () => {
    const t = io();
    const blocked = await run(['test', 'read_file', '{"path":"/etc/passwd"}'], t);
    expect(blocked.code).toBe(2);
    expect(t.out()).toContain('"decision": "block"');
    const t2 = io();
    expect((await run(['test', 'read_file', '{"path":"./README.md"}'], t2)).code).toBe(0);
    expect(t2.out()).toContain('"decision": "allow"');
  });

  it('observe mode allows and says what it would have blocked', async () => {
    const t = io();
    expect((await run(['test', '--mode', 'observe', 'read_file', '{"path":"/etc/passwd"}'], t)).code).toBe(0);
    expect(t.out()).toMatch(/would have blocked/i);
  });

  it('bad JSON arguments: exit 1 with a message', async () => {
    const t = io();
    expect((await run(['test', 'read_file', '{nope'], t)).code).toBe(1);
    expect(t.err()).toMatch(/JSON/);
  });
});

describe('mastyf-check proxy', () => {
  async function session() {
    const t = io();
    const handle = await run(['proxy', '--', process.execPath, FAKE_MCP], t);
    const lines: Array<Record<string, any>> = [];
    let buf = '';
    t.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) lines.push(JSON.parse(line));
      }
    });
    const request = async (id: number, method: string, params?: unknown) => {
      t.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      for (let i = 0; i < 400; i++) {
        const hit = lines.find((l) => l.id === id);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`no answer for ${method}`);
    };
    return { request, close: () => handle.close?.() };
  }

  it('passes ordinary calls through and blocks a sensitive one before the server sees it', async () => {
    const s = await session();
    try {
      await s.request(1, 'initialize', {});
      const ok = await s.request(2, 'tools/call', { name: 'read_file', arguments: { path: './README.md' } });
      expect(ok.result.content[0].text).toBe('contents of ./README.md');
      const blocked = await s.request(3, 'tools/call', { name: 'read_file', arguments: { path: '/etc/passwd' } });
      expect(blocked.error?.message).toMatch(/Blocked by Mastyf/);
    } finally {
      await s.close();
    }
  });

  it("blocks a result that tries to take over the agent, so the model never sees it", async () => {
    const s = await session();
    try {
      const r = await s.request(1, 'tools/call', { name: 'fetch_page', arguments: { url: 'https://docs.example.org' } });
      expect(r.error?.message).toMatch(/Blocked by Mastyf/);
      expect(JSON.stringify(r).toLowerCase()).not.toContain('ignore all previous');
    } finally {
      await s.close();
    }
  });

  it('notices a server changing its tool definitions mid-session', async () => {
    const s = await session();
    try {
      await s.request(1, 'tools/list');
      await s.request(2, 'tools/call', { name: 'change_tools', arguments: {} });
      await s.request(3, 'tools/list');
      const r = await s.request(4, 'tools/call', { name: 'read_file', arguments: { path: './README.md' } });
      expect(r.error?.message).toMatch(/Blocked by Mastyf/);
    } finally {
      await s.close();
    }
  });
});
