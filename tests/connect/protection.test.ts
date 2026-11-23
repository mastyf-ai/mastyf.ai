import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentInventory } from '../../src/auto-discovery/agent-inventory.js';
import { isServerProtected } from '../../src/auto-discovery/agent-inventory.js';
import { ProtectionService } from '../../src/connect/protection.js';

const repo = path.resolve(__dirname, '../..');
let home: string;
let service: ProtectionService;
let claude: string;

type Servers = Record<string, Record<string, unknown>>;
const read = () => JSON.parse(fs.readFileSync(claude, 'utf8')) as { mcpServers: Servers; keep?: string };
const write = (mcpServers: Servers) => {
  fs.writeFileSync(claude, JSON.stringify({ keep: 'me', mcpServers }, null, 2));
  // Two writes inside one clock tick would look unchanged to the watcher.
  const t = new Date(Date.now() + Math.floor(Math.random() * 1e6) + 1000);
  fs.utimesSync(claude, t, t);
};
const scan = (): AgentInventory => {
  const servers = Object.entries(read().mcpServers).map(([name, s]) => ({ name, transport: 'stdio' as const, protected: isServerProtected(s) }));
  return {
    scannedAt: new Date().toISOString(),
    agents: [{ id: 'claude-code', name: 'Claude Code', configPath: claude, servers }],
    totals: { agents: 1, servers: servers.length, protectedServers: servers.filter((s) => s.protected).length },
  };
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'mastyf-protection-'));
  claude = path.join(home, '.claude.json');
  service = new ProtectionService({ projectRoot: repo, home, scan });
});
afterEach(() => {
  service.stop();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('protection switch', () => {
  it('changes nothing until it is turned on', () => {
    write({ files: { command: 'node', args: ['server.js'] } });
    const before = fs.readFileSync(claude, 'utf8');
    service.start();
    service.tick();
    expect(service.status()).toMatchObject({ enabled: false, watching: false });
    expect(fs.readFileSync(claude, 'utf8')).toBe(before);
  });

  it('protects what is there, then whatever is added, and leaves other settings alone', () => {
    write({ files: { command: 'node', args: ['server.js'] } });
    const on = service.enable();
    expect(on).toMatchObject({ enabled: true, watching: true, totals: { servers: 1, protectedServers: 1 } });
    expect(on.agents[0].servers[0].via).toBe('mastyf');
    expect(read().keep).toBe('me');

    write({ ...read().mcpServers, github: { command: 'npx', args: ['-y', 'some-server'] } });
    service.tick();
    expect(isServerProtected(read().mcpServers.github)).toBe(true);
    expect(service.status().events[0]).toMatchObject({ kind: 'protected', agent: 'claude-code', servers: ['github'] });
  });

  it('restores every server when turned off', () => {
    write({ files: { command: 'node', args: ['server.js'], env: { TOKEN: 'x' } } });
    service.enable();
    write({ ...read().mcpServers, github: { command: 'npx', args: ['g'] } });
    service.tick();
    const off = service.disable();
    expect(off).toMatchObject({ enabled: false, watching: false });
    expect(read().mcpServers).toEqual({
      files: { command: 'node', args: ['server.js'], env: { TOKEN: 'x' } },
      github: { command: 'npx', args: ['g'] },
    });
  });

  it('leaves a server another Mastyf already fronts, and says so', () => {
    const shield = { command: 'node.exe', args: ['proxy-launcher.cjs', 'proxy', '--config', 'a.json', '--policy', 'p.yaml'] };
    write({ 'shield-demo': shield });
    expect(service.enable().agents[0].servers[0].via).toBe('other');
    expect(read().mcpServers['shield-demo']).toEqual(shield);
    service.disable();
    expect(read().mcpServers['shield-demo']).toEqual(shield);
  });

  it('remembers it is on after a restart', () => {
    write({});
    service.enable();
    service.stop();
    const restarted = new ProtectionService({ projectRoot: repo, home, scan });
    restarted.start();
    expect(restarted.status()).toMatchObject({ enabled: true, watching: true });
    restarted.stop();
  });
});
