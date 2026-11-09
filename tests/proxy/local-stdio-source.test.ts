import { beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => [] as { localStdio?: boolean }[]);
vi.mock('../../src/proxy/tool-call-defense-orchestrator.js', () => ({
  evaluateToolCallDefense: vi.fn(async (input: { localStdio?: boolean }) => {
    captured.push(input);
    return { allowed: false, phase: 'policy', code: -32001, rule: 't', reason: 't' };
  }),
}));

import { McpProxyServer } from '../../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../../src/database/history-db.js';

const call = (id: number) =>
  JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'echo', arguments: {} } });

describe('where a request came from', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it('marks only real stdin input as the local client', async () => {
    const proxy = new McpProxyServer(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {}, new HistoryDatabase(':memory:'), 't', { getMode: () => 'block' } as never);
    await proxy.handleClientInput(call(1));
    await proxy.handleClientInput(call(2), { localStdio: true });
    proxy.kill();
    expect(captured.map((c) => c.localStdio === true)).toEqual([false, true]);
  });
});
