import { describe, it, expect, afterEach } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { McpProxyServer } from '../../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { PolicyConfig } from '../../src/policy/policy-types.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const HUNG_SERVER = resolve(__dir, '../../benchmarks/fixtures/hung-server.cjs');

// The proxy now refuses to dispatch a tools/call that no policy engine
// authorised. To exercise timeout handling the call must be legitimately
// forwarded, so allow the hung tool through explicitly.
const allowHungPolicy: PolicyConfig = {
  version: '1.0',
  policy: {
    mode: 'block',
    rules: [{ name: 'allow-hang', action: 'pass', tools: { allow: ['hang'] } }],
    default_action: 'block',
  },
};

describe('Proxy request timeout', () => {
  let proxy: McpProxyServer | null = null;
  const stdoutLines: string[] = [];
  let origWrite: typeof process.stdout.write;

  afterEach(() => {
    proxy?.kill();
    proxy = null;
    stdoutLines.length = 0;
    process.stdout.write = origWrite;
  });

  it('returns JSON-RPC error when upstream hangs past requestTimeoutMs', async () => {
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
      stdoutLines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;

    const db = new HistoryDatabase(':memory:');
    proxy = new McpProxyServer('node', [HUNG_SERVER], {}, db, 'hung-test', new PolicyEngine(allowHungPolicy), undefined, 200);
    await new Promise((r) => setTimeout(r, 400));

    await proxy.handleClientInput(JSON.stringify({
      jsonrpc: '2.0',
      id: 'timeout-1',
      method: 'tools/call',
      params: { name: 'hang', arguments: {} },
    }));

    await new Promise((r) => setTimeout(r, 350));

    const responses = stdoutLines.flatMap((block) =>
      block.split('\n').filter(Boolean).map((line) => {
        try {
          return JSON.parse(line) as { id?: string; error?: { code: number; message: string } };
        } catch {
          return null;
        }
      }).filter(Boolean),
    );

    db.close();
    const err = responses.find((r) => r?.id === 'timeout-1' && r.error);
    expect(err?.error?.code).toBe(-32006);
    expect(err?.error?.message).toMatch(/timed out/i);
  }, 10000);
});
