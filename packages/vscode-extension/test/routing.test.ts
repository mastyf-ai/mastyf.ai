import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/servers.json';
import { routingState, upstreamFromFreeConnect } from '../src/routing';

const noFile = (): string => {
  throw new Error('no file');
};

describe('routingState matches Shield 0.5.2', () => {
  for (const f of fixtures) {
    it(`${f.name}: ${f.why}`, () => {
      expect(routingState(f.server, f.name, noFile)).toBe(f.expected);
    });
  }
});

describe('servers set up by the free `mastyf connect`', () => {
  const freeEntry = { command: 'mastyf', args: ['proxy', '--config', 'C:/cfg/free.json', '--policy', 'p.yaml'] };
  const upstreamFile = JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['server-filesystem'] } } });
  const readUpstream = (p: string) => {
    if (p === 'C:/cfg/free.json') return upstreamFile;
    throw new Error('missing');
  };

  it('finds the upstream server', () => {
    expect(upstreamFromFreeConnect(freeEntry, 'files', readUpstream)).toEqual({ command: 'npx', args: ['server-filesystem'] });
  });

  it('ignores entries Shield wrote', () => {
    expect(upstreamFromFreeConnect({ ...freeEntry, _mastyf: { managed: true, version: 2 } }, 'files', readUpstream)).toBeNull();
  });

  it('returns null when the config file cannot be read', () => {
    expect(upstreamFromFreeConnect(freeEntry, 'files', noFile)).toBeNull();
  });

  it('counts them as needing Shield to fix them', () => {
    expect(routingState(freeEntry, 'files', readUpstream)).toBe('fixable');
  });
});
