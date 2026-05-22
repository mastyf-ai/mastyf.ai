import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { McpProxyServer } from '../../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import { PolicyConfig } from '../../src/policy/policy-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ECHO_SERVER = resolve(__dirname, '..', '..', 'benchmarks', 'fixtures', 'echo-server.cjs');

const BLOCKING_POLICY: PolicyConfig = {
  version: '1.0',
  policy: {
    mode: 'block',
    rules: [
      { name: 'deny-eval', action: 'block', tools: { deny: ['eval', 'execute_command', 'bash', 'sh'] } },
      { name: 'shell-injection', action: 'block', patterns: ['rm\\s+-rf', 'curl\\s|wget\\s'] },
    ],
  },
};

function createCall(id: number, method: string, tool: string, args: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: String(id),
    method,
    params: method === 'tools/call' ? { name: tool, arguments: args } : {},
  }) + '\n';
}

function createInitialize(id: number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: String(id),
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'integration-test', version: '1.0' },
    },
  }) + '\n';
}

async function waitForResponse(
  responses: Map<string, unknown>,
  id: string,
  timeoutMs = 8000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = responses.get(id);
    if (hit) return hit as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for response id=${id}`);
}

describe('E2E: Real MCP Server with Proxy', () => {
  let db: HistoryDatabase;
  let policyEngine: PolicyEngine;
  let proxy: McpProxyServer;
  const responses = new Map<string, unknown>();
  let origWrite: typeof process.stdout.write;

  beforeAll(async () => {
    db = new HistoryDatabase(':memory:');
    policyEngine = new PolicyEngine(BLOCKING_POLICY);
    proxy = new McpProxyServer('node', [ECHO_SERVER], {}, db, 'integration-echo', policyEngine);

    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = function (chunk: unknown, ...args: unknown[]): boolean {
      try {
        const msg = JSON.parse(String(chunk));
        if (msg.id !== undefined && msg.id !== null) responses.set(String(msg.id), msg);
      } catch {
        /* ignore */
      }
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    };

    proxy.handleClientInput(createInitialize(0));
    await waitForResponse(responses, '0', 5000);
  });

  afterAll(() => {
    process.stdout.write = origWrite;
    proxy.kill();
    db.close();
  });

  it('should pass a safe tools/call', async () => {
    proxy.handleClientInput(createCall(1, 'tools/call', 'search', { query: 'hello' }));
    const resp = await waitForResponse(responses, '1');
    expect(resp.error).toBeUndefined();
    expect(resp.result).toBeDefined();
  });

  it('should block a denied tool', async () => {
    proxy.handleClientInput(createCall(2, 'tools/call', 'eval', {}));
    const resp = await waitForResponse(responses, '2');
    expect(resp.error).toBeDefined();
    expect((resp.error as { code?: number }).code).toBe(-32001);
    expect(String((resp.error as { message?: string }).message)).toContain('denied');
  });

  it('should block execute_command tool', async () => {
    proxy.handleClientInput(createCall(3, 'tools/call', 'execute_command', { command: 'ls' }));
    const resp = await waitForResponse(responses, '3');
    expect(resp.error).toBeDefined();
    expect((resp.error as { code?: number }).code).toBe(-32001);
  });

  it('should block shell injection pattern in arguments', async () => {
    proxy.handleClientInput(createCall(4, 'tools/call', 'search', { query: 'rm -rf /' }));
    const resp = await waitForResponse(responses, '4');
    expect(resp.error).toBeDefined();
    expect((resp.error as { code?: number }).code).toBe(-32001);
    expect(String((resp.error as { message?: string }).message)).toMatch(/rm|shell|destructive|Blocked/i);
  });

  it('should capture real token data in DB', async () => {
    for (let i = 10; i <= 12; i++) {
      proxy.handleClientInput(createCall(i, 'tools/call', 'search', { query: `q${i}` }));
      await waitForResponse(responses, String(i));
    }

    const records = await db.getCallRecordsForServer('integration-echo');
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0]!.toolName).toBe('search');
    expect(records[0]!.totalTokens).toBeGreaterThan(0);
  });
});
