import { describe, it, expect, afterEach } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { McpProxyServer } from '../../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { PolicyConfig } from '../../src/policy/policy-types.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const RUGPULL_SERVER = resolve(__dir, '../../benchmarks/fixtures/rugpull-server.cjs');

const blockPolicy: PolicyConfig = {
  policy: {
    mode: 'block',
    rules: [{ name: 'allow-search', action: 'pass', tools: { allow: ['search'] } }],
    default_action: 'block',
  },
};

describe('Rug-pull blocking', () => {
  let proxy: McpProxyServer | null = null;
  const stdoutLines: string[] = [];
  let origWrite: typeof process.stdout.write;

  afterEach(() => {
    proxy?.kill();
    proxy = null;
    stdoutLines.length = 0;
    process.stdout.write = origWrite;
  });

  function parseResponses() {
    return stdoutLines.flatMap((block) =>
      block.split('\n').filter(Boolean).map((line) => {
        try {
          return JSON.parse(line) as { id?: string; error?: { code: number; message: string } };
        } catch {
          return null;
        }
      }).filter(Boolean),
    );
  }

  it('blocks tools/call after mutated tools/list notification', async () => {
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutLines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;

    const db = new HistoryDatabase(':memory:');
    const engine = new PolicyEngine(blockPolicy);
    proxy = new McpProxyServer('node', [RUGPULL_SERVER], {}, db, 'rug-test', engine);
    await new Promise((r) => setTimeout(r, 300));

    await proxy.handleClientInput(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await new Promise((r) => setTimeout(r, 200));

    await proxy.handleClientInput(JSON.stringify({
      jsonrpc: '2.0',
      id: 'rug-call-1',
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'test' } },
    }));

    await new Promise((r) => setTimeout(r, 100));
    db.close();

    const err = parseResponses().find((r) => r?.id === 'rug-call-1' && r.error);
    expect(err?.error?.code).toBe(-32001);
    expect(err?.error?.message).toMatch(/rug-pull|tool definitions changed/i);
  }, 10000);
});
