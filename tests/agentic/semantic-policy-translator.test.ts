import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  policyToNaturalLanguage,
  naturalLanguageToPolicy,
} from '../../src/agentic/semantic-policy/translator.js';
import {
  storePolicyDraft,
  markPolicyDraftApproved,
  markPolicyDraftApplied,
  clearPolicyDraftsForTests,
} from '../../src/agentic/semantic-policy/policy-approval-store.js';

describe('C5 semantic policy translator (dedicated suite)', () => {
  describe('approval store lifecycle', () => {
    beforeEach(() => clearPolicyDraftsForTests());
    afterEach(() => clearPolicyDraftsForTests());

    it('tracks pending → approved → applied for dashboard flow', () => {
      const draft = storePolicyDraft({
        requestId: 'c5-flow-1',
        goal: 'block curl',
        rule: { name: 'deny-curl', action: 'block', tools: { deny: ['curl'] } },
        yaml: 'policy:\n  rules:\n    - name: deny-curl',
      });
      expect(draft.status).toBe('pending');
      expect(markPolicyDraftApproved('c5-flow-1')).toBe(true);
      expect(markPolicyDraftApplied('c5-flow-1')).toBe(true);
    });
  });

  it('explains policy with rule sections', async () => {
    const summary = await policyToNaturalLanguage(
      {
        version: '1.0',
        policy: {
          mode: 'block',
          rules: [
            { name: 'deny-curl', action: 'block', tools: { deny: ['curl'] } },
            { name: 'require-gold', action: 'block', require_certification: 'gold' },
          ],
        },
      },
      { useLlm: false },
    );
    expect(summary.ruleCount).toBe(2);
    expect(summary.sections.some(s => s.title === 'deny-curl')).toBe(true);
  });

  it('generates draft from NL goal with replay matrix', async () => {
    const draft = await naturalLanguageToPolicy('block execute_command in shell tools', { skipReplay: true });
    expect(draft).not.toBeNull();
    expect(draft!.replay).toBeDefined();
    expect(draft!.yaml).toMatch(/execute_command|deny|block/i);
  });

  it('rejects unsafe policy rules via validatePolicyRuleSafe', async () => {
    const { validatePolicyRuleSafe } = await import('../../src/ai/threat-lab.js');
    const errors = validatePolicyRuleSafe({
      name: 'unsafe-bypass',
      action: 'block',
      patterns: ['curl http://evil.example'],
    });
    expect(errors.some(e => e.includes('dangerous unblock'))).toBe(true);
  });
});
