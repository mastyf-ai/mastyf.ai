import { describe, expect, it } from 'vitest';
import { decide } from '../../../src/ai/causal-gate/decide.js';
import type { OriginMatch } from '../../../src/ai/causal-gate/ledger.js';

const fromEmail: OriginMatch = {
  argPath: 'recipient',
  value: 'us133000000121212121212',
  sources: [{ server: 'mail', tool: 'get_email', fieldPath: 'body', origin: 'attacker_writable' }],
};
const base = { tool: 'send_money', sensitive: ['recipient'] };

describe('decide', () => {
  it('always allows reads', () => {
    const d = decide({ ...base, effect: 'read', matches: [fromEmail] });
    expect(d.action).toBe('allow');
  });

  it('holds a risky action whose target only came from attacker-writable data, and says why', () => {
    const d = decide({ ...base, effect: 'external_send', matches: [fromEmail] });
    expect(d.action).toBe('hold');
    expect(d.rule).toBe('causal-origin');
    expect(d.message).toContain('recipient');
    expect(d.message).toContain('get_email');
    expect(d.message).toContain('body');
    expect(d.evidence).toEqual([fromEmail]);
  });

  it('allows a value also seen somewhere not attacker-writable', () => {
    for (const origin of ['trusted', 'unknown'] as const) {
      const both = { ...fromEmail, sources: [...fromEmail.sources, { server: 's', tool: 't', fieldPath: 'f', origin }] };
      expect(decide({ ...base, effect: 'external_send', matches: [both] }).action).toBe('allow');
    }
  });

  it('ignores matches in arguments that are not sensitive', () => {
    const d = decide({ ...base, sensitive: ['other'], effect: 'external_send', matches: [fromEmail] });
    expect(d.action).toBe('allow');
  });

  it('allows a risky action with no evidence', () => {
    expect(decide({ ...base, effect: 'irreversible', matches: [] }).action).toBe('allow');
  });
});
