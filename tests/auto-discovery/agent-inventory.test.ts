import { describe, expect, it } from 'vitest';
import { isServerProtected, scanAgentInventory } from '../../src/auto-discovery/agent-inventory.js';

describe('agent inventory: is a server already behind Mastyf?', () => {
  it('recognises the Shield marker and the proxy wrappers', () => {
    expect(isServerProtected({ _mastyf: { managed: true } })).toBe(true);
    expect(isServerProtected({ command: 'mastyf', args: ['proxy', '--', 'npx', 'x'] })).toBe(true);
    expect(isServerProtected({ command: 'node', args: ['/opt/mastyf-ai/dist/cli.js', 'proxy', '--config', 'c.json'] })).toBe(true);
    expect(isServerProtected({ command: 'mastyf-ai-proxy' })).toBe(true);
  });

  it('treats a plain server as unprotected', () => {
    expect(isServerProtected({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] })).toBe(false);
    expect(isServerProtected({ url: 'https://example.com/mcp' })).toBe(false);
  });

  it('returns names only, never commands, arguments or environment', () => {
    const inv = scanAgentInventory();
    expect(inv.totals.servers).toBe(inv.agents.reduce((n, a) => n + a.servers.length, 0));
    for (const a of inv.agents) {
      for (const s of a.servers) {
        expect(Object.keys(s).sort()).toEqual(['name', 'protected', 'transport']);
      }
    }
  });
});
