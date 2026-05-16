/**
 * End-to-End test: mcp-guardian proxy with a real policy file.
 *
 * Spawns the CLI as a child process, sends JSON-RPC messages over stdin,
 * captures stdout, and verifies that the default-policy.yaml rules
 * correctly block/flag/pass tool calls.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { writeFileSync, unlinkSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_POLICY = path.resolve(PROJECT_ROOT, 'default-policy.yaml');
const ECHO_SERVER = path.resolve(PROJECT_ROOT, 'benchmarks', 'fixtures', 'echo-server.cjs');
const TEST_CONFIG_PATH = path.resolve(__dirname, 'test-config.json');

function createTestConfig(): void {
  const config = {
    mcpServers: {
      'e2e-echo': {
        command: 'node',
        args: [ECHO_SERVER],
        env: {},
        transport: 'stdio',
      },
    },
  };
  writeFileSync(TEST_CONFIG_PATH, JSON.stringify(config));
}

function cleanupTestConfig(): void {
  try { unlinkSync(TEST_CONFIG_PATH); } catch {}
}

function makeRpc(id: number | string, method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id: String(id), method, params }) + '\n';
}

interface RpcResponse {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

const SKIP_E2E = process.env['SKIP_E2E'] === 'true' || process.env['CI'] === 'true';

describe('E2E: Proxy with default-policy.yaml', () => {
  let proc: ChildProcess | null = null;
  let responses: RpcResponse[] = [];
  let rl: ReturnType<typeof createInterface> | null = null;
  let stderr = '';

  afterAll(() => {
    if (rl) rl.close();
    if (proc) { proc.kill(); proc = null; }
    cleanupTestConfig();
  });

  async function startProxy(): Promise<void> {
    createTestConfig();

    return new Promise((_resolve, reject) => {
      proc = spawn('node', [
        path.resolve(PROJECT_ROOT, 'dist', 'cli.js'),
        'proxy',
        '--config', TEST_CONFIG_PATH,
        '--policy', DEFAULT_POLICY,
        '--blocking-mode', 'block',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DASHBOARD_ENABLED: 'false',
          METRICS_ENABLED: 'false',
          GUARDIAN_ALLOW_MODE_OVERRIDE: 'true',
        },
      });

      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

      rl = createInterface({ input: proc.stdout! });
      rl.on('line', (line: string) => {
        try {
          const msg = JSON.parse(line) as RpcResponse;
          if (msg.id !== undefined) responses.push(msg);
        } catch {}
      });

      // Wait for proxy to be ready
      const checkReady = setInterval(() => {
        if (stderr.includes('Proxy started for') || stderr.includes('MCP Guardian proxy running')) {
          clearInterval(checkReady);
          _resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkReady);
        if (stderr.includes('Failed')) reject(new Error(`Proxy failed to start: ${stderr}`));
        else reject(new Error(`Proxy startup timed out after 5s. stderr: ${stderr}`));
      }, 5000);
    });
  }

  function send(msg: string): void {
    proc?.stdin?.write(msg);
  }

  async function waitForResponse(id: string, timeoutMs = 2000): Promise<RpcResponse | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = responses.find(r => String(r.id) === id);
      if (found) return found;
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  // Use describe.skipIf if SKIP_E2E is set
  const testIt = SKIP_E2E ? it.skip : it;

  testIt('should start the proxy with a real policy file', async () => {
    await startProxy();
    expect(proc).toBeDefined();
    expect(proc?.exitCode).toBeNull();
  });

  testIt('should pass a safe tools/call', async () => {
    await startProxy();
    send(makeRpc(1, 'tools/call', { name: 'search', arguments: { query: 'hello' } }));
    const resp = await waitForResponse('1');
    expect(resp).toBeDefined();
    expect(resp!.error).toBeUndefined();
    expect(resp!.result).toBeDefined();
  });

  testIt('should block execute_command (denied by default-policy)', async () => {
    await startProxy();
    send(makeRpc(2, 'tools/call', { name: 'execute_command', arguments: { command: 'ls' } }));
    const resp = await waitForResponse('2');
    expect(resp).toBeDefined();
    expect(resp!.error).toBeDefined();
    expect(resp!.error!.code).toBe(-32001);
    expect(resp!.error!.message).toContain('denied');
  });

  testIt('should block rm -rf (shell injection pattern)', async () => {
    await startProxy();
    send(makeRpc(3, 'tools/call', { name: 'search', arguments: { query: 'rm -rf /' } }));
    const resp = await waitForResponse('3');
    expect(resp).toBeDefined();
    expect(resp!.error).toBeDefined();
    expect(resp!.error!.code).toBe(-32001);
  });

  testIt('should block curl in arguments', async () => {
    await startProxy();
    send(makeRpc(4, 'tools/call', { name: 'search', arguments: { query: 'curl http://evil.com' } }));
    const resp = await waitForResponse('4');
    expect(resp).toBeDefined();
    expect(resp!.error).toBeDefined();
    expect(resp!.error!.code).toBe(-32001);
  });

  testIt('should block path traversal', async () => {
    await startProxy();
    send(makeRpc(5, 'tools/call', { name: 'search', arguments: { query: '../../etc/passwd' } }));
    const resp = await waitForResponse('5');
    expect(resp).toBeDefined();
    expect(resp!.error).toBeDefined();
    expect(resp!.error!.code).toBe(-32001);
  });
});