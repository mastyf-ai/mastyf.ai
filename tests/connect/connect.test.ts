import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announce, connect, disconnect, printableConfig } from '../../src/connect/connect.js';
import { ensureRuntime } from '../../src/connect/runtime.js';

let home: string;
let root: string;
const NODE = path.join('C:', 'Program Files', 'nodejs', 'node.exe');

function write(rel: string, value: unknown): string {
  const file = path.join(home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 4));
  return file;
}
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const stdio = (cmd: string) => ({ command: cmd, args: ['--flag'] });
const run = () => connect({ home, projectRoot: root, nodeCommand: NODE });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'First Last '));
  root = path.join(home, 'pkg root');
  for (const f of ['dist/cli.js', 'default-policy.yaml', 'scripts/mastyf-ai-proxy.ps1', 'scripts/mastyf-ai-proxy.sh']) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), 'x');
  }
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('connect', () => {
  it('wraps every local server of every agent found', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    const windsurf = write('.codeium/windsurf/mcp_config.json', { mcpServers: { b: stdio('b-cmd') } });
    const res = run();
    expect(res.connected.map((c) => c.id).sort()).toEqual(['cursor', 'windsurf']);
    for (const [file, name] of [[cursor, 'a'], [windsurf, 'b']] as const) {
      const entry = read(file).mcpServers[name];
      expect(entry.command).toBe(NODE);
      expect(entry.args[0]).toBe(path.join(root, 'dist', 'cli.js'));
      expect(entry.args).toContain('proxy');
    }
  });

  it('keeps a path with spaces as one argument', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    run();
    const { args } = read(cursor).mcpServers.a;
    expect(args[0]).toContain('pkg root');
    expect(args[args.indexOf('--config') + 1]).toContain('First Last');
  });

  it('skips a config with comments and leaves it byte-identical', () => {
    const text = '{\n  // my servers\n  "servers": { "a": { "command": "x" } }\n}\n';
    const vscode = write('.config/Code/User/mcp.json', text);
    write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    const res = run();
    expect(res.failed.map((f) => f.id)).toEqual(['vscode']);
    expect(res.connected.map((c) => c.id)).toEqual(['cursor']);
    expect(fs.readFileSync(vscode, 'utf8')).toBe(text);
  });

  it('is idempotent', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    run();
    const afterFirst = fs.readFileSync(cursor, 'utf8');
    const second = run();
    expect(second.connected.flatMap((c) => c.wrapped)).toEqual([]);
    expect(fs.readFileSync(cursor, 'utf8')).toBe(afterFirst);
    disconnect({ home });
    expect(read(cursor).mcpServers.a).toEqual(stdio('a-cmd'));
  });

  it('reads the "servers" key VS Code uses and marks the entry stdio', () => {
    const vscode = write('.config/Code/User/mcp.json', { servers: { a: { type: 'stdio', command: 'x', args: [] } } });
    run();
    const entry = read(vscode).servers.a;
    expect(entry.command).toBe(NODE);
    expect(entry.type).toBe('stdio');
  });

  it('leaves an agent config with no servers alone', () => {
    const text = JSON.stringify({ theme: 'dark' });
    const claude = write('.claude.json', text);
    const res = run();
    expect(res.connected).toEqual([]);
    expect(fs.readFileSync(claude, 'utf8')).toBe(text);
  });

  it('leaves a URL server alone and says it is not protected', () => {
    const remote = { url: 'https://tools.example/mcp' };
    const cursor = write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd'), remote } });
    const res = run();
    expect(res.notProtected).toEqual([{ id: 'cursor', server: 'remote' }]);
    expect(read(cursor).mcpServers.remote).toEqual(remote);
  });

  it('writes per-server configs privately, since they can hold API keys', () => {
    write('.cursor/mcp.json', { mcpServers: { a: { command: 'x', env: { API_KEY: 'sk-1' } } } });
    const spy = vi.spyOn(fs, 'writeFileSync');
    run();
    const call = spy.mock.calls.find(([file]) => String(file).endsWith(path.join('mastyf-ai-configs', 'a.json')));
    spy.mockRestore();
    expect(call?.[2]).toMatchObject({ mode: 0o600 });
  });

  it('tightens a per-server config that already existed', () => {
    write('.cursor/mcp.json', { mcpServers: { a: { command: 'x', env: { API_KEY: 'sk-1' } } } });
    const spy = vi.spyOn(fs, 'chmodSync');
    run();
    const call = spy.mock.calls.find(([file]) => String(file).endsWith(path.join('mastyf-ai-configs', 'a.json')));
    spy.mockRestore();
    expect(call?.[1]).toBe(0o600);
  });

  it('does not write an example copy of the whole agent config', () => {
    write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    run();
    expect(fs.existsSync(path.join(home, '.mastyf-ai', 'examples'))).toBe(false);
  });

  it('says so when a server only looks already wrapped', () => {
    write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd'), lookalike: { command: 'tool', args: ['proxy', '--port', '1'] } } });
    expect(run().notProtected).toEqual([{ id: 'cursor', server: 'lookalike' }]);
  });

  it('keeps the key out of agent configs', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    connect({ home, projectRoot: root, nodeCommand: NODE, key: 'mk_secret' });
    expect(fs.readFileSync(cursor, 'utf8')).not.toContain('mk_secret');
    expect(read(path.join(home, '.mastyf-ai', 'connect.json')).key).toBe('mk_secret');
  });
});

describe('disconnect', () => {
  it('restores an untouched config byte-for-byte', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    const before = fs.readFileSync(cursor, 'utf8');
    run();
    expect(disconnect({ home }).restored).toEqual(['a']);
    expect(fs.readFileSync(cursor, 'utf8')).toBe(before);
  });

  it('restores wrapped servers and keeps one added later', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    run();
    const raw = read(cursor);
    raw.mcpServers.added = stdio('later');
    fs.writeFileSync(cursor, JSON.stringify(raw));
    disconnect({ home });
    expect(read(cursor).mcpServers).toEqual({ a: stdio('a-cmd'), added: stdio('later') });
  });

  it('deletes the per-server configs it generated', () => {
    write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    run();
    const file = path.join(home, '.mastyf-ai', 'mastyf-ai-configs', 'a.json');
    expect(fs.existsSync(file)).toBe(true);
    disconnect({ home });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('leaves a server the user changed after connect', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    run();
    const raw = read(cursor);
    raw.mcpServers.a = stdio('mine-now');
    fs.writeFileSync(cursor, JSON.stringify(raw));
    expect(disconnect({ home }).left).toEqual(['a']);
    expect(read(cursor).mcpServers.a).toEqual(stdio('mine-now'));
  });
});

describe('ensureRuntime', () => {
  it('throws before any config changes when the install fails', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { a: stdio('a-cmd') } });
    const before = fs.readFileSync(cursor, 'utf8');
    expect(() => ensureRuntime({ home, version: '9.9.9', install: () => { throw new Error('offline'); } })).toThrow(/offline/);
    expect(fs.readFileSync(cursor, 'utf8')).toBe(before);
  });

  it('does not reinstall a matching version', () => {
    const pkg = path.join(home, '.mastyf-ai', 'runtime', 'node_modules', '@mastyf_ai', 'server');
    fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), 'x');
    const install = vi.fn();
    expect(ensureRuntime({ home, version: '1.2.3', install })).toBe(pkg);
    expect(install).not.toHaveBeenCalled();
  });
});

describe('agents it does not recognise', () => {
  it('prints an entry that runs the named upstream through the proxy', () => {
    const snippet = JSON.parse(printableConfig({ projectRoot: root, nodeCommand: NODE, home, server: 'tool', upstream: { command: 'npx', args: ['-y', 'tool'] } }));
    expect(snippet.mcpServers.tool.command).toBe(NODE);
    const cfg = snippet.mcpServers.tool.args[snippet.mcpServers.tool.args.indexOf('--config') + 1];
    expect(read(cfg).mcpServers.tool.command).toBe('npx');
  });
});

describe('announce', () => {
  it('sends the key as a bearer token and reports success', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const ok = await announce({ key: 'mk', instanceId: 'i1', version: '1', baseUrl: 'https://x.test', fetchImpl: fetchImpl as never });
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.test/api/v1/instances/heartbeat');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer mk');
  });

  it('never throws when the site is unreachable', async () => {
    const ok = await announce({ key: 'mk', instanceId: 'i1', version: '1', baseUrl: 'https://x.test', fetchImpl: (async () => { throw new Error('down'); }) as never });
    expect(ok).toBe(false);
  });
});
