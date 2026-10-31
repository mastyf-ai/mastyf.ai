import { LAYA_VERDICT_QUESTION } from './verdict-question';

const DEFAULT_FORWARD_TIMEOUT_MS = 1300;

export type LayaForwardResult =
  | { ok: true; choice: 'safe' | 'unsafe'; confidence: number }
  | { ok: false };

function forwardTimeoutMs(): number {
  const n = parseInt(process.env.LAYA_FORWARD_TIMEOUT_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_FORWARD_TIMEOUT_MS;
}

/**
 * Asks one Laya server the verdict question. Sends only the state and the question, with that
 * server's own secret; nothing identifying the workspace. Never logs, and any failure or
 * unexpected reply is just `{ ok: false }` so no upstream text reaches the caller.
 */
export async function forwardToLaya(
  target: { endpoint: string; secret: string },
  state: string,
): Promise<LayaForwardResult> {
  try {
    const res = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${target.secret}`,
      },
      body: JSON.stringify({ state, questions: { verdict: LAYA_VERDICT_QUESTION } }),
      signal: AbortSignal.timeout(forwardTimeoutMs()),
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as {
      answers?: { verdict?: { choice?: unknown; answer_confidence?: unknown } };
    } | null;
    const verdict = body?.answers?.verdict;
    const choice = verdict?.choice;
    const confidence = verdict?.answer_confidence;
    if (choice !== 'safe' && choice !== 'unsafe') return { ok: false };
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return { ok: false };
    if (confidence < 0 || confidence > 1) return { ok: false };
    return { ok: true, choice, confidence };
  } catch {
    return { ok: false };
  }
}
