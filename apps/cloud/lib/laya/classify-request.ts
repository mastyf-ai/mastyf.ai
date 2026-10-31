import { isDeepStrictEqual } from 'node:util';
import { LAYA_VERDICT_QUESTION } from './verdict-question';

export const MAX_STATE_BYTES = 16384;

const EXPECTED_QUESTIONS = { verdict: LAYA_VERDICT_QUESTION };

/**
 * Accepts only `{ state, questions: { verdict } }` with the exact verdict question and a state of
 * at most 16 KB (UTF-8). Anything else, including a caller's `model`, never reaches Laya.
 */
export function parseClassifyBody(raw: string): { ok: true; state: string } | { ok: false } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };

  const { state, questions } = body as { state?: unknown; questions?: unknown };
  if (typeof state !== 'string' || state.length === 0) return { ok: false };
  if (Buffer.byteLength(state, 'utf8') > MAX_STATE_BYTES) return { ok: false };
  if (!isDeepStrictEqual(questions, EXPECTED_QUESTIONS)) return { ok: false };
  return { ok: true, state };
}
