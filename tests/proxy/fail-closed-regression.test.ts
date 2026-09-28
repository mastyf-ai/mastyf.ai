import { describe, it, expect, afterEach, beforeEach, afterAll } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { McpProxyServer } from '../../src/proxy/proxy-server.js';
import { HistoryDatabase } from '../../src/database/history-db.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { PolicyConfig, CallContext, PolicyDecision } from '../../src/policy/policy-types.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ECHO_SERVER = resolve(__dir, '../../benchmarks/fixtures/echo-server.cjs');

const basePolicy: PolicyConfig = {
  version: '1.0',
  policy: {
    mode: 'block',
    rules: [{ name: 'allow-echo', action: 'pass', tools: { allow: ['echo'] } }],
    default_action: 'block',
  },
};

describe('P0 Fail-Closed Invariant Regression Suite (PolicyError => BLOCK => 0 Downstream Bytes)', () => {
  let proxy: McpProxyServer | null = null;
  const stdoutLines: string[] = [];
  let origStdoutWrite: typeof process.stdout.write;
  const prevTimingNormalize = process.env.MASTYF_AI_PROXY_TIMING_NORMALIZE;
  const prevEnvelope = process.env.MASTYF_AI_POLICY_TIMING_ENVELOPE;

  beforeEach(() => {
    process.env.MASTYF_AI_PROXY_TIMING_NORMALIZE = 'false';
    process.env.MASTYF_AI_POLICY_TIMING_ENVELOPE = 'false';
  });

  afterAll(() => {
    process.env.MASTYF_AI_PROXY_TIMING_NORMALIZE = prevTimingNormalize;
    process.env.MASTYF_AI_POLICY_TIMING_ENVELOPE = prevEnvelope;
  });

  afterEach(() => {
    proxy?.kill();
    proxy = null;
    stdoutLines.length = 0;
    if (origStdoutWrite) {
      process.stdout.write = origStdoutWrite;
    }
  });

  function setupClientStdoutCapture() {
    origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutLines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;
  }

  function parseClientResponses() {
    return stdoutLines.flatMap((block) =>
      block
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as {
              id?: string | number;
              error?: { code: number; message: string; data?: Record<string, unknown> };
              result?: unknown;
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
  }

  function attachSocketByteCounter(p: McpProxyServer) {
    let downstreamBytes = 0;
    let backendInvocations = 0;
    const childStdin = (p as unknown as { child: { stdin: { write: (c: unknown, ...a: unknown[]) => boolean } } }).child?.stdin;
    expect(childStdin).toBeDefined();

    const origChildWrite = childStdin.write.bind(childStdin);
    childStdin.write = ((chunk: unknown, ...args: unknown[]) => {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(typeof chunk === 'string' ? chunk : String(chunk));
      downstreamBytes += buf.length;
      backendInvocations++;
      return (origChildWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    }) as typeof childStdin.write;

    return {
      getDownstreamBytes: () => downstreamBytes,
      getBackendInvocations: () => backendInvocations,
    };
  }

  it('fails closed (0 downstream bytes, backend count 0) when policy engine throws a synchronous exception', async () => {
    setupClientStdoutCapture();
    const db = new HistoryDatabase(':memory:');
    const engine = new PolicyEngine(basePolicy);

    // Inject synchronous exception into policy evaluateAsync
    engine.evaluateAsync = () => {
      throw new Error('Fatal crash during policy evaluation');
    };

    proxy = new McpProxyServer('node', [ECHO_SERVER], {}, db, 'test-sync-error', engine);
    await new Promise((r) => setTimeout(r, 200));

    const counter = attachSocketByteCounter(proxy);

    await proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-sync-err',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'benign-payload' } },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 100));
    db.close();

    // Verification of invariant:
    // policy throws -> decision BLOCK -> downstream bytes = 0 -> backend invocation count = 0
    expect(counter.getDownstreamBytes()).toBe(0);
    expect(counter.getBackendInvocations()).toBe(0);

    const clientResp = parseClientResponses().find((r) => r?.id === 'call-sync-err');
    expect(clientResp).toBeDefined();
    expect(clientResp?.error?.code).toBe(-32001);
    expect(clientResp?.error?.message).toMatch(/POLICY_ENGINE_ERROR|failing closed/i);
  });

  it('fails closed (0 downstream bytes, backend count 0) when policy engine returns a promise rejection', async () => {
    setupClientStdoutCapture();
    const db = new HistoryDatabase(':memory:');
    const engine = new PolicyEngine(basePolicy);

    // Inject rejected promise
    engine.evaluateAsync = () => Promise.reject(new Error('Async policy promise rejected'));

    proxy = new McpProxyServer('node', [ECHO_SERVER], {}, db, 'test-rejection', engine);
    await new Promise((r) => setTimeout(r, 200));

    const counter = attachSocketByteCounter(proxy);

    await proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-rejection',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'attempt' } },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 100));
    db.close();

    expect(counter.getDownstreamBytes()).toBe(0);
    expect(counter.getBackendInvocations()).toBe(0);

    const clientResp = parseClientResponses().find((r) => r?.id === 'call-rejection');
    expect(clientResp?.error?.code).toBe(-32001);
    expect(clientResp?.error?.message).toMatch(/POLICY_ENGINE_ERROR|failing closed/i);
  });

  it('fails closed (0 downstream bytes, backend count 0) when policy returns undefined', async () => {
    setupClientStdoutCapture();
    const db = new HistoryDatabase(':memory:');
    const engine = new PolicyEngine(basePolicy);

    // Inject undefined result
    engine.evaluateAsync = (() => Promise.resolve(undefined as unknown as PolicyDecision)) as unknown as (ctx: CallContext) => Promise<PolicyDecision>;

    proxy = new McpProxyServer('node', [ECHO_SERVER], {}, db, 'test-undefined', engine);
    await new Promise((r) => setTimeout(r, 200));

    const counter = attachSocketByteCounter(proxy);

    await proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-undefined',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'test' } },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 100));
    db.close();

    expect(counter.getDownstreamBytes()).toBe(0);
    expect(counter.getBackendInvocations()).toBe(0);

    const clientResp = parseClientResponses().find((r) => r?.id === 'call-undefined');
    expect(clientResp?.error?.code).toBe(-32001);
  });

  it('fails closed (0 downstream bytes, backend count 0) when policy returns null', async () => {
    setupClientStdoutCapture();
    const db = new HistoryDatabase(':memory:');
    const engine = new PolicyEngine(basePolicy);

    // Inject null result
    engine.evaluateAsync = (() => Promise.resolve(null as unknown as PolicyDecision)) as unknown as (ctx: CallContext) => Promise<PolicyDecision>;

    proxy = new McpProxyServer('node', [ECHO_SERVER], {}, db, 'test-null', engine);
    await new Promise((r) => setTimeout(r, 200));

    const counter = attachSocketByteCounter(proxy);

    await proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-null',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'test' } },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 100));
    db.close();

    expect(counter.getDownstreamBytes()).toBe(0);
    expect(counter.getBackendInvocations()).toBe(0);

    const clientResp = parseClientResponses().find((r) => r?.id === 'call-null');
    expect(clientResp?.error?.code).toBe(-32001);
  });

  it('fails closed (0 downstream bytes, backend count 0) when policy returns a malformed decision object', async () => {
    setupClientStdoutCapture();
    const db = new HistoryDatabase(':memory:');
    const engine = new PolicyEngine(basePolicy);

    // Inject malformed object (missing action)
    engine.evaluateAsync = (() => Promise.resolve({ notAnAction: 42 } as unknown as PolicyDecision)) as unknown as (ctx: CallContext) => Promise<PolicyDecision>;

    proxy = new McpProxyServer('node', [ECHO_SERVER], {}, db, 'test-malformed', engine);
    await new Promise((r) => setTimeout(r, 200));

    const counter = attachSocketByteCounter(proxy);

    await proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-malformed',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'test' } },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 100));
    db.close();

    expect(counter.getDownstreamBytes()).toBe(0);
    expect(counter.getBackendInvocations()).toBe(0);

    const clientResp = parseClientResponses().find((r) => r?.id === 'call-malformed');
    expect(clientResp?.error?.code).toBe(-32001);
  });

  it('fails closed (0 downstream bytes, backend count 0) when policy evaluation times out', async () => {
    setupClientStdoutCapture();
    const db = new HistoryDatabase(':memory:');
    const engine = new PolicyEngine(basePolicy);

    // Inject timeout rejection
    engine.evaluateAsync = () =>
      new Promise((_, reject) => setTimeout(() => reject(new Error('Policy evaluation timeout after 500ms')), 50));

    proxy = new McpProxyServer('node', [ECHO_SERVER], {}, db, 'test-timeout', engine);
    await new Promise((r) => setTimeout(r, 200));

    const counter = attachSocketByteCounter(proxy);

    await proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-timeout',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'test' } },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 150));
    db.close();

    expect(counter.getDownstreamBytes()).toBe(0);
    expect(counter.getBackendInvocations()).toBe(0);

    const clientResp = parseClientResponses().find((r) => r?.id === 'call-timeout');
    expect(clientResp?.error?.code).toBe(-32001);
  });

  it('fails closed at runtime (0 downstream bytes) if policyEngine is missing', async () => {
    setupClientStdoutCapture();
    const db = new HistoryDatabase(':memory:');

    // Create proxy with no policy engine in non-production mode
    proxy = new McpProxyServer('node', [ECHO_SERVER], {}, db, 'test-missing-engine');
    await new Promise((r) => setTimeout(r, 200));

    const counter = attachSocketByteCounter(proxy);

    await proxy.handleClientInput(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-missing-engine',
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'test' } },
      }) + '\n',
    );

    await new Promise((r) => setTimeout(r, 100));
    db.close();

    expect(counter.getDownstreamBytes()).toBe(0);
    expect(counter.getBackendInvocations()).toBe(0);

    const clientResp = parseClientResponses().find((r) => r?.id === 'call-missing-engine');
    expect(clientResp?.error?.code).toBe(-32001);
    expect(clientResp?.error?.message).toMatch(/policy engine missing; failing closed/i);
  });

  it('fails startup in production mode if policyEngine is missing', () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string | undefined>)['NODE_ENV'] = 'production';
      const db = new HistoryDatabase(':memory:');

      expect(() => {
        new McpProxyServer('node', [ECHO_SERVER], {}, db, 'test-prod-startup');
      }).toThrow(/\[PRODUCTION STARTUP FAILURE\]/i);

      db.close();
    } finally {
      (process.env as Record<string, string | undefined>)['NODE_ENV'] = prevEnv;
    }
  });

  it('fails startup when MASTYF_SECURITY_MODE=production and policyEngine is missing', () => {
    const prevSec = process.env.MASTYF_SECURITY_MODE;
    try {
      process.env.MASTYF_SECURITY_MODE = 'production';
      const db = new HistoryDatabase(':memory:');

      expect(() => {
        new McpProxyServer('node', [ECHO_SERVER], {}, db, 'test-sec-mode-startup');
      }).toThrow(/\[PRODUCTION STARTUP FAILURE\]/i);

      db.close();
    } finally {
      process.env.MASTYF_SECURITY_MODE = prevSec;
    }
  });
});
