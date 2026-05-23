import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HttpProxyServer } from '../../src/proxy/http-proxy-server.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import { injectRotatedSessionIntoResult } from '../../src/utils/mcp-session-meta.js';

describe('HttpProxyServer response gate', () => {
  const prevMode = process.env.GUARDIAN_RESPONSE_DLP_MODE;

  afterEach(() => {
    if (prevMode) process.env.GUARDIAN_RESPONSE_DLP_MODE = prevMode;
    else delete process.env.GUARDIAN_RESPONSE_DLP_MODE;
  });

  beforeEach(() => {
    process.env.GUARDIAN_RESPONSE_DLP_MODE = 'block';
  });

  it('blocks tool result via inspectToolResponse in block mode', async () => {
    const policy = new PolicyEngine({
      version: '1.0',
      policy: { mode: 'block', default_action: 'block', rules: [] },
    });
    const proxy = new HttpProxyServer('http://127.0.0.1:9', 'http-gate', policy);

    const msg = {
      jsonrpc: '2.0',
      id: 42,
      result: { note: 'patient ssn 123-45-6789' },
    };
    const inspected = await (proxy as any).inspectToolResponse('read_file', msg, 42);
    expect(inspected.blocked?.error?.code).toBe(-32002);
    expect(String(inspected.blocked?.error?.message)).toContain('blocked');
  });

  it('redacts tool result in redact mode', async () => {
    process.env.GUARDIAN_RESPONSE_DLP_MODE = 'redact';
    const policy = new PolicyEngine({
      version: '1.0',
      policy: { mode: 'block', default_action: 'block', rules: [] },
    });
    const proxy = new HttpProxyServer('http://127.0.0.1:9', 'http-redact', policy);

    const msg = {
      jsonrpc: '2.0',
      id: 7,
      result: { note: 'patient ssn 123-45-6789' },
    };
    const inspected = await (proxy as any).inspectToolResponse('read_file', msg, 7);
    expect(inspected.blocked).toBeNull();
    expect(inspected.redactionReasons?.length).toBeGreaterThan(0);
    expect(JSON.stringify(msg.result)).not.toContain('123-45-6789');
  });

  it('injectRotatedSessionIntoResult matches http proxy behavior', () => {
    const msg = { jsonrpc: '2.0', id: 3, result: { ok: true } };
    injectRotatedSessionIntoResult(msg, 'http-rotated');
    expect((msg.result as { _meta: { sessionToken: string } })._meta.sessionToken).toBe('http-rotated');
  });
});
