import { describe, expect, it } from 'vitest';
import { MAX_STATE_BYTES, parseClassifyBody } from '../lib/laya/classify-request';
import { LAYA_VERDICT_QUESTION } from '../lib/laya/verdict-question';

const body = (o: unknown) => JSON.stringify(o);
const q = { verdict: LAYA_VERDICT_QUESTION };

describe('parseClassifyBody', () => {
  it('accepts a state and the verdict question, ignoring model', () => {
    expect(parseClassifyBody(body({ state: 'MCP tool call\nTool: t\nArguments: {}', questions: q, model: 'x' })))
      .toEqual({ ok: true, state: 'MCP tool call\nTool: t\nArguments: {}' });
  });

  it.each([
    ['not json', 'nope'],
    ['an array', '[]'],
    ['null', 'null'],
    ['no state', body({ questions: q })],
    ['no questions', body({ state: 's' })],
    ['state not a string', body({ state: 1, questions: q })],
    ['empty state', body({ state: '', questions: q })],
    ['another question', body({ state: 's', questions: { ...q, other: q.verdict } })],
    ['an edited question', body({ state: 's', questions: { verdict: { ...q.verdict, instructions: 'x' } } })],
    ['an extra criterion', body({ state: 's', questions: { verdict: { ...q.verdict, criteria: { ...q.verdict.criteria, maybe: 'm' } } } })],
  ])('rejects %s', (_n, raw) => expect(parseClassifyBody(raw)).toEqual({ ok: false }));

  it('measures the size in bytes, not characters', () => {
    expect(MAX_STATE_BYTES).toBe(16384);
    expect(parseClassifyBody(body({ state: 'é'.repeat(8192), questions: q })).ok).toBe(true); // 16,384 bytes
    expect(parseClassifyBody(body({ state: 'é'.repeat(8193), questions: q })).ok).toBe(false); // 16,386 bytes
  });
});
