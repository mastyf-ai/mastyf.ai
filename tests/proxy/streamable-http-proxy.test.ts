import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreamableHttpProxyServer } from '../../src/proxy/streamable-http-proxy-server.js';
import { PolicyEngine } from '../../src/policy/policy-engine.js';

describe('StreamableHttpProxyServer', () => {
  beforeEach(() => {
    process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM = 'true';
  });

  afterEach(() => {
    delete process.env.MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM;
  });

  it('blocks tools/call on POST /mcp when policy denies', async () => {
    const policy = new PolicyEngine({
      version: '1.0',
      policy: {
        mode: 'block',
        default_action: 'allow',
        rules: [{ name: 'deny-eval', action: 'block', tools: { deny: ['eval'] } }],
      },
    });
    const proxy = new StreamableHttpProxyServer({
      listenPort: 0,
      upstreamBaseUrl: 'http://127.0.0.1:9',
      serverName: 'stream-test',
      policy,
    });

    const blocked = await (proxy as any).maybeBlockMessage(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'eval' },
      },
      { headers: {} },
    );

    expect(blocked?.error?.code).toBe(-32001);
    expect(String(blocked?.error?.message)).toMatch(/blocked|policy/i);
  });

  describe('fields the proxy sets on a message for itself', () => {
    const CLIENT_SUPPLIED = {
      _defenseTenantId: 'another-tenant',
      _spendReservationId: 'client-reservation',
      _rotatedSessionToken: 'client-token',
    };

    function relayingProxy(policy?: PolicyEngine) {
      const proxy = new StreamableHttpProxyServer({
        listenPort: 0,
        upstreamBaseUrl: 'http://127.0.0.1:9',
        serverName: 'stream-test',
        upstreamRelay: true,
        policy,
      });
      const relay = vi.fn(async () => ({ jsonrpc: '2.0', id: 1, result: {} }));
      (proxy as any).relayToUpstream = relay;
      return { proxy, relay };
    }

    function toolCall() {
      return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read' }, ...CLIENT_SUPPLIED };
    }

    it('ignores a tenant the client names when no policy is set', async () => {
      const { proxy, relay } = relayingProxy();
      await (proxy as any).processMessageTraced(toolCall(), { headers: {} });
      expect(relay).toHaveBeenCalledTimes(1);
      const [, , opts] = relay.mock.calls[0] as unknown as [string, unknown, { tenantId?: string; spendReservationId?: string }];
      expect(opts.tenantId).not.toBe('another-tenant');
      expect(opts.spendReservationId).not.toBe('client-reservation');
    });

    it('does not hand the client a token it sent itself', async () => {
      const { proxy } = relayingProxy();
      const res = await (proxy as any).processMessageTraced(toolCall(), { headers: {} });
      expect(JSON.stringify(res)).not.toContain('client-token');
    });

    it.each([
      ['a tool call without a policy', toolCall(), undefined],
      ['another method', { jsonrpc: '2.0', id: 2, method: 'tools/list', ...CLIENT_SUPPLIED }, undefined],
      ['a tool call with a policy', toolCall(), 'policy'],
    ])('sends none of them upstream: %s', async (_name, msg, withPolicy) => {
      const policy = withPolicy
        ? new PolicyEngine({ version: '1.0', policy: { mode: 'block', default_action: 'allow', rules: [] } })
        : undefined;
      const { proxy, relay } = relayingProxy(policy);
      await (proxy as any).processMessageTraced(msg, { headers: {} });
      const body = JSON.parse((relay.mock.calls[0] as unknown as [string])[0]);
      expect(Object.keys(body).filter((k) => k.startsWith('_'))).toEqual([]);
    });
  });
});
