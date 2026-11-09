import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, disconnect, printableConfig, readConnectState } from '../../src/connect/connect.js';
import { managedConfigFileName } from '../../src/wrap/client-wrap.js';

let home: string;
let root: string;
const NODE = '/abs/node';
const run = () => connect({ home, projectRoot: root, nodeCommand: NODE });

function write(rel: string, value: unknown): string {
  const file = path.join(home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 4));
  return file;
}
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const perServer = (entry: { args: string[] }) => read(entry.args[entry.args.indexOf('--config') + 1]);

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-review-'));
  root = path.join(home, 'pkg');
  for (const f of ['dist/cli.js', 'default-policy.yaml', 'scripts/mastyf-ai-proxy.ps1', 'scripts/mastyf-ai-proxy.sh']) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), 'x');
  }
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('servers with the same name in different agents', () => {
  const twoAgents = () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { github: { command: 'gh', env: { TOKEN: 'WORK' } } } });
    const windsurf = write('.codeium/windsurf/mcp_config.json', { mcpServers: { github: { command: 'gh', env: { TOKEN: 'PERSONAL' } } } });
    run();
    return { cursor, windsurf };
  };

  it('keeps each agent on its own upstream', () => {
    const { cursor, windsurf } = twoAgents();
    expect(perServer(read(cursor).mcpServers.github).mcpServers.github.env.TOKEN).toBe('WORK');
    expect(perServer(read(windsurf).mcpServers.github).mcpServers.github.env.TOKEN).toBe('PERSONAL');
  });

  it('does not let names that sanitise alike collide', () => {
    expect(managedConfigFileName('cursor', 'a.b')).not.toBe(managedConfigFileName('cursor', 'a_b'));
  });
});

describe('disconnect when something goes wrong', () => {
  const connected = () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { s: { command: 'tool' } } });
    run();
    return cursor;
  };

  it('falls back to per-server restore when the backup is gone', () => {
    const cursor = connected();
    fs.rmSync(readConnectState(home)!.agents[0]!.backupPath!);
    expect(disconnect({ home }).restored).toEqual(['s']);
    expect(read(cursor).mcpServers.s).toEqual({ command: 'tool' });
  });

  it('keeps the undo record when an agent cannot be restored', () => {
    const cursor = connected();
    const wrapped = fs.readFileSync(cursor, 'utf8');
    fs.writeFileSync(cursor, `// a comment\n${wrapped}`);
    const res = disconnect({ home });
    expect(res.failed).toEqual(['s']);
    expect(res.left).toEqual([]);
    fs.writeFileSync(cursor, wrapped.replace('"x"', '"x"') + ' ');
    expect(disconnect({ home }).restored).toEqual(['s']);
  });
});

describe('what wrapping must not lose', () => {
  it('keeps settings such as disabled, autoApprove and cwd on the wrapped entry', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { s: { command: 'tool', disabled: true, autoApprove: ['x'], cwd: '/w' } } });
    run();
    expect(read(cursor).mcpServers.s).toMatchObject({ disabled: true, autoApprove: ['x'], cwd: '/w', command: NODE });
  });

  it('leaves a server using agent variables direct and says so', () => {
    const entry = { command: 'tool', args: ['${workspaceFolder}'] };
    const cursor = write('.cursor/mcp.json', { mcpServers: { s: entry } });
    expect(run().notProtected).toEqual([{ id: 'cursor', server: 's' }]);
    expect(read(cursor).mcpServers.s).toEqual(entry);
  });

  it('reports project-scoped Claude Code servers as not protected', () => {
    write('.claude.json', { projects: { '/repo': { mcpServers: { local: { command: 'x' } } } } });
    expect(run().notProtected).toEqual([{ id: 'claude-code', server: 'local' }]);
  });

  it('stops UI-managed servers being merged into a wrapped proxy', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { s: { command: 'tool' } } });
    run();
    expect(read(cursor).mcpServers.s.env.MASTYF_AI_FLEET_CHILD).toBe('true');
  });
});

describe('the undo record', () => {
  it('is saved before the agent config changes', () => {
    const cursor = write('.cursor/mcp.json', { mcpServers: { s: { command: 'tool' } } });
    const state = path.join(home, '.mastyf-ai', 'connect.json');
    const order: string[] = [];
    const real = fs.writeFileSync;
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (file === state && String(rest[0]).includes('"s"')) order.push('state');
      if (file === cursor) order.push('config');
      return (real as (...a: unknown[]) => void)(file, ...rest);
    }) as typeof fs.writeFileSync);
    run();
    spy.mockRestore();
    expect(order[0]).toBe('state');
    expect(order).toContain('config');
  });
});

describe('print-config for a URL server', () => {
  it('prints the direct entry, since the proxy cannot front a URL yet', () => {
    const snippet = JSON.parse(printableConfig({ projectRoot: root, nodeCommand: NODE, home, server: 't', upstream: { url: 'https://x.test/mcp' } }));
    expect(snippet.mcpServers.t).toEqual({ url: 'https://x.test/mcp' });
  });
});
