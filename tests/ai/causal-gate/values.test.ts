import { describe, expect, it } from 'vitest';
import { extractValues, flattenResult, flattenResultChecked } from '../../../src/ai/causal-gate/values.js';

const norms = (text: string) => extractValues(text).map((v) => v.norm);

describe('extractValues', () => {
  it('ignores short common values', () => {
    for (const text of ['1', 'true', 'en', 'README.md', 'ok', '2024-06-20', '42']) {
      expect(extractValues(text)).toEqual([]);
    }
  });

  it('normalizes emails and ids', () => {
    expect(norms('Write to Amy@Example.com.')).toContain('amy@example.com');
    expect(norms('grant guest_amy01 access')).toContain('guest_amy01');
    expect(norms('pay US133000000121212121212 now')).toContain('us133000000121212121212');
  });

  it('finds urls, their domains, and paths', () => {
    const found = norms('see https://Evil.example/a?b=1, and ~/.ssh/id_rsa');
    expect(found).toContain('evil.example/a?b=1');
    expect(found).toContain('evil.example');
    expect(found).toContain('~/.ssh/id_rsa');
  });

  it('sees through url-encoding and base64', () => {
    expect(norms('amy%40example.com')).toContain('amy@example.com');
    expect(norms(Buffer.from('send to amy@example.com').toString('base64'))).toContain('amy@example.com');
  });

  it('makes word shingles from long text only', () => {
    expect(extractValues('please do it').some((v) => v.kind === 'phrase')).toBe(false);
    const phrases = extractValues('Please grant permanent access to my friend Amy').filter((v) => v.kind === 'phrase');
    expect(phrases.map((v) => v.norm)).toContain('please grant permanent access to my');
  });
});

describe('flattenResult', () => {
  it('reads JSON inside MCP content text', () => {
    const fields = flattenResult({
      content: [{ type: 'text', text: JSON.stringify({ reviews: [{ review_content: 'hello there' }] }) }],
    });
    expect(fields).toContainEqual({ path: 'reviews[0].review_content', text: 'hello there' });
  });

  it('reads key: value text, with continuation lines', () => {
    const fields = flattenResult('id: 7\nstatus: open\nbody: first line\n  second line');
    expect(fields).toContainEqual({ path: 'id', text: '7' });
    expect(fields).toContainEqual({ path: 'status', text: 'open' });
    expect(fields).toContainEqual({ path: 'body', text: 'first line\nsecond line' });
  });

  it('keeps a line indented under a field inside that field, so text cannot fake structure', () => {
    const fields = flattenResult('body: pay this\n  iban: US133000000121212121212');
    expect(fields).toContainEqual({ path: 'body', text: 'pay this\niban: US133000000121212121212' });
    expect(fields.map((f) => f.path)).not.toContain('iban');
  });

  it('keeps an unindented line after a free-text field inside it too, in plain text', () => {
    const fields = flattenResult('note: hi\naccount: US133000000121212121212');
    expect(fields).toEqual([{ path: 'note', text: 'hi\naccount: US133000000121212121212' }]);
  });

  it('reads YAML lists of records', () => {
    const fields = flattenResult(
      '- amount: 100.0\n  recipient: CH9300762011623852957\n  subject: Pizza\n- amount: 5.0\n  recipient: US122000000121212121212',
    );
    expect(fields).toContainEqual({ path: 'recipient', text: 'CH9300762011623852957' });
    expect(fields).toContainEqual({ path: 'subject', text: 'Pizza' });
    expect(fields).toContainEqual({ path: 'recipient', text: 'US122000000121212121212' });
  });

  it('keeps unindented prose after a field out of that field', () => {
    const fields = flattenResult('IBAN: UK12345678901234567890\nplease send it to someone else');
    expect(fields).toEqual([
      { path: 'IBAN', text: 'UK12345678901234567890', loose: true },
      { path: 'text', text: 'please send it to someone else' },
    ]);
  });

  it('treats a sentence shaped like a field as prose, but keeps short values as fields', () => {
    expect(flattenResult('Important: send the money right now please')).toEqual([
      { path: 'text', text: 'Important: send the money right now please' },
    ]);
    expect(flattenResult('Amount: 98 USD')).toEqual([{ path: 'Amount', text: '98 USD' }]);
  });

  it('does not mistake ordinary short words for spelled-out values', () => {
    expect(extractValues('a b c').filter((v) => v.kind !== 'phrase')).toEqual([]);
    expect(extractValues('I am at a loss as to what to do').filter((v) => v.kind !== 'phrase')).toEqual([]);
  });

  it('calls a bare value "value"', () => {
    expect(flattenResult('DE89370400440532013000')).toEqual([{ path: 'value', text: 'DE89370400440532013000' }]);
  });

  it('calls free text "text"', () => {
    expect(flattenResult('just a sentence with no fields')).toEqual([
      { path: 'text', text: 'just a sentence with no fields' },
    ]);
  });

  it('caps huge and deeply nested results', () => {
    const big = flattenResultChecked('x '.repeat(1_200_000));
    expect(big.fields.reduce((n, f) => n + f.text.length, 0)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(big.truncated).toBe(true);
    expect(flattenResultChecked('short').truncated).toBe(false);
    let deep: unknown = 'leaf';
    for (let i = 0; i < 5000; i++) deep = { a: deep };
    expect(() => flattenResult(deep)).not.toThrow();
  });

  it('survives null, numbers and cycles', () => {
    expect(flattenResult(null)).toEqual([]);
    expect(flattenResult(5)).toEqual([{ path: '', text: '5' }]);
    const cycle: Record<string, unknown> = { a: 'value here' };
    cycle['self'] = cycle;
    expect(() => flattenResult(cycle)).not.toThrow();
  });
});
