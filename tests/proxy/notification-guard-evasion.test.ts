import { describe, it, expect, afterEach } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { McpProxyServer } from '../../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { PolicyConfig } from '../../src/policy/policy-types.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const RECORDER = resolve(__dir, '../fixtures/exec-recorder-server.cjs');

const SERVER = 'notif-test';

// Anything other than `echo` is denied, so `secret_tool` exercises the guard.
const policy: PolicyConfig = {
  policy: {
    mode: 'block',
    rules: [{ name: 'allow-echo', action: 'pass', tools: { allow: ['echo'] } }],
    default_action: 'block',
  },
};

describe('guard evasion via omitted JSON-RPC id', () => {
  let proxy: McpProxyServer | null = null;
  let db: HistoryDatabase | null = null;
  const stdoutLines: string[] = [];
  let origWrite: typeof process.stdout.write;

  afterEach(() => {
    proxy?.kill();
    proxy = null;
    db?.close();
    db = null;
    stdoutLines.length = 0;
    process.stdout.write = origWrite;
  });

  function captureStdout() {
    origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutLines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;
  }

  function responses(): { id?: string; error?: { code: number } }[] {
    return stdoutLines
      .flatMap((c) => c.split('\n').filter(Boolean))
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as { id?: string; error?: { code: number } }];
        } catch {
          return [];
        }
      });
  }

  async function startProxy() {
    db = new HistoryDatabase(':memory:');
    proxy = new McpProxyServer('node', [RECORDER], {}, db, SERVER, new PolicyEngine(policy));
    await new Promise((r) => setTimeout(r, 400));
  }

  /**
   * Audit records are the oracle for "did the guard run?".
   *
   * A stdout-based oracle cannot work here: a notification's reply is dropped
   * by design, so "blocked" and "executed but unanswered" look identical on the
   * wire. The guard's own audit record is deterministic — the fixed code runs
   * the gauntlet for an id-less call and records the denial, while the
   * id-gated code skips the gauntlet entirely and records nothing at all.
   */
  type CallRecord = { toolName: string; blocked: boolean; blockReason?: string };

  /**
   * Poll for the expected record instead of sleeping a fixed interval.
   *
   * `persistCallRecord` is fire-and-forget, and a permitted call cannot have a
   * record at all until the recorder child has booted and answered — so a fixed
   * sleep is a race that the permitted case reliably loses, while the denial
   * cases win only because the guard short-circuits before the child is
   * involved. Polling makes the wait condition the thing actually being tested.
   */
  async function waitForRecord(
    predicate: (r: CallRecord) => boolean,
    timeoutMs = 10_000,
  ): Promise<CallRecord[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = (await db!.getCallRecordsForServer(SERVER)).filter(predicate);
      if (hit.length > 0 || Date.now() >= deadline) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it('runs the tool-call guard for a tools/call that omits its id', async () => {
    captureStdout();
    await startProxy();

    // The bypass: a `tools/call` with no `id` is a JSON-RPC notification, and
    // previously skipped the entire tool-call guard gauntlet.
    await proxy!.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'secret_tool', arguments: { path: '/etc/passwd' } },
      }),
    );

    const denied = await waitForRecord((r) => r.blocked && r.toolName === 'secret_tool');
    expect(denied.map((d) => d.toolName)).toContain('secret_tool');
  }, 25000);

  it('emits no response body for a blocked notification', async () => {
    captureStdout();
    await startProxy();

    await proxy!.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'secret_tool', arguments: { path: '/etc/passwd' } },
      }),
    );

    // Establish the denial before asserting silence: otherwise this passes for
    // the wrong reason — a request dropped before the guard also emits nothing.
    const denied = await waitForRecord((r) => r.blocked && r.toolName === 'secret_tool');
    expect(denied.map((d) => d.toolName)).toContain('secret_tool');

    // A notification must never be answered.
    expect(responses()).toHaveLength(0);
  }, 25000);

  it('still blocks the same call when an id is present', async () => {
    captureStdout();
    await startProxy();

    await proxy!.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'with-id',
        method: 'tools/call',
        params: { name: 'secret_tool', arguments: { path: '/etc/passwd' } },
      }),
    );

    // The denial record is written before the error frame is flushed, so waiting
    // on the record makes the stdout assertion deterministic.
    const denied = await waitForRecord((r) => r.blocked && r.toolName === 'secret_tool');
    expect(denied.map((d) => d.toolName)).toContain('secret_tool');

    const err = responses().find((r) => r.id === 'with-id' && r.error);
    expect(err?.error?.code).toBe(-32001);
  }, 25000);

  it('still allows an identified permitted call (harness sanity check)', async () => {
    captureStdout();
    await startProxy();

    await proxy!.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'allowed',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'hi' } },
      }),
    );

    // Polls until the upstream has actually answered, which is the only moment a
    // non-blocked record can exist. A fixed sleep here asserts nothing but the
    // speed of the sandbox.
    const allowed = await waitForRecord((r) => r.toolName === 'echo');
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.every((r) => r.blocked === false)).toBe(true);
  }, 25000);
});
