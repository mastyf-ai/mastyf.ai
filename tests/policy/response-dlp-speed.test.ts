import { describe, expect, it } from 'vitest';
import { evaluateResponseDlp } from '../../src/policy/response-dlp.js';

describe('response DLP: time grows with the text, not its square', () => {
  it('256 KB of one repeated character: under 2 s', () => {
    const body = JSON.stringify({ content: 'a'.repeat(256 * 1024) });
    const t = Date.now();
    evaluateResponseDlp('read_file', 'files', body);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('a minified-code-like line of 256 KB: under 2 s', () => {
    const body = JSON.stringify({ content: 'var a=b.c+d;'.repeat(22000) });
    const t = Date.now();
    evaluateResponseDlp('read_file', 'files', body);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('response DLP: a bulk list of email addresses is still caught', () => {
  it('five or more addresses in a row', () => {
    const list = ['asha.verma', 'ravi.k', 'li.wei+news', 'j.doe', 'm.ortiz'].map((n) => `${n}@acme-corp.com`).join(', ') + ', ';
    const r = evaluateResponseDlp('query', 'crm', list);
    expect(r.findings.map((f) => f.ruleId)).toContain('pii-email-bulk');
  });

  it('two addresses are not a bulk list', () => {
    const r = evaluateResponseDlp('query', 'crm', 'asha.verma@acme-corp.com, ravi.k@acme-corp.com, ');
    expect(r.findings.map((f) => f.ruleId)).not.toContain('pii-email-bulk');
  });
});
