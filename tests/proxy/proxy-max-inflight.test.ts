import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpProxyServer } from '../../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';

describe('McpProxyServer max inflight', () => {
  const prev = process.env['GUARDIAN_PROXY_MAX_INFLIGHT'];

  afterEach(() => {
    if (prev === undefined) delete process.env['GUARDIAN_PROXY_MAX_INFLIGHT'];
    else process.env['GUARDIAN_PROXY_MAX_INFLIGHT'] = prev;
    vi.restoreAllMocks();
  });

  it('rejects tools/call when in-flight limit reached', async () => {
    process.env['GUARDIAN_PROXY_MAX_INFLIGHT'] = '1';
    const db = new HistoryDatabase(':memory:');
    const proxy = new McpProxyServer(
      'node',
      ['-e', 'process.stdin.resume()'],
      { PATH: process.env.PATH || '' },
      db,
      'inflight-test',
    );

    (proxy as any).requestContexts.set('pending-1', {
      requestStartTime: Date.now(),
      requestToolName: 'blocked-slot',
      requestTokens: 0,
      tenantId: 'default',
    });

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      if (typeof chunk === 'string') lines.push(chunk);
      return true;
    });

    await proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'b',
        method: 'tools/call',
        params: { name: 'y', arguments: {} },
      }),
    );

    const overloaded = lines.find((l) => l.includes('proxy overloaded'));
    expect(overloaded).toBeDefined();
    expect(overloaded).toContain('-32005');

    proxy.kill();
  });

  it('does not invoke policy evaluateAsync when over inflight cap', async () => {
    process.env['GUARDIAN_PROXY_MAX_INFLIGHT'] = '1';
    const db = new HistoryDatabase(':memory:');
    const engine = new PolicyEngine({
      version: '1',
      policy: { mode: 'block', rules: [] },
    });
    const evaluateSpy = vi.spyOn(engine, 'evaluateAsync');
    const proxy = new McpProxyServer(
      'node',
      ['-e', 'process.stdin.resume()'],
      { PATH: process.env.PATH || '' },
      db,
      'inflight-policy-skip',
      engine,
    );

    (proxy as any).requestContexts.set('pending-1', {
      requestStartTime: Date.now(),
      requestToolName: 'blocked-slot',
      requestTokens: 0,
      tenantId: 'default',
    });

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'c',
        method: 'tools/call',
        params: { name: 'z', arguments: {} },
      }),
    );

    expect(evaluateSpy).not.toHaveBeenCalled();
    proxy.kill();
  });
});
