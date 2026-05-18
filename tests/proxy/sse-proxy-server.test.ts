import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SseProxyServer } from '../../src/proxy/sse-proxy-server.js';
import type { PolicyEngine } from '../../src/policy/policy-engine.js';

describe('SseProxyServer', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses evaluateAsync for tools/call policy checks', async () => {
    const evaluateAsync = vi.fn().mockResolvedValue({
      action: 'block',
      rule: 'test-rule',
      reason: 'blocked for test',
    });
    const policy = { evaluateAsync } as unknown as PolicyEngine;
    const db = {
      addCallRecord: vi.fn(),
    };

    const proxy = new SseProxyServer({
      upstreamUrl: 'http://127.0.0.1:9/never-called',
      serverName: 'sse-test',
      policy,
      db: db as any,
    });

    const result = await proxy.interceptAndForward({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'eval', arguments: { cmd: 'id' } },
    });

    expect(evaluateAsync).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      error: { code: -32001 },
    });
  });

  it('passes through when evaluateAsync allows', async () => {
    const evaluateAsync = vi.fn().mockResolvedValue({
      action: 'pass',
      rule: 'default',
      reason: 'ok',
    });
    const policy = {
      evaluateAsync,
      evaluateResponse: vi.fn().mockReturnValue({ clean: true, detections: [] }),
      getMode: vi.fn().mockReturnValue('audit'),
    } as unknown as PolicyEngine;

    const proxy = new SseProxyServer({
      upstreamUrl: 'http://127.0.0.1:9/never-called',
      serverName: 'sse-test',
      policy,
      db: {} as any,
    });

    const forwardSpy = vi
      .spyOn(proxy as any, '_forwardToUpstream')
      .mockResolvedValue({ jsonrpc: '2.0', id: 2, result: { ok: true } });

    const result = await proxy.interceptAndForward({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '/tmp/x' } },
    });

    expect(evaluateAsync).toHaveBeenCalledOnce();
    expect(forwardSpy).toHaveBeenCalled();
    expect(result).toMatchObject({ result: { ok: true } });
  });
});
