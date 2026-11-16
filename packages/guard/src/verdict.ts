/** What a check decided. `result` holds the cleaned result when `decision` is "redact". */
export interface Verdict {
  decision: 'allow' | 'block' | 'redact';
  id: string;
  layer?: string;
  rule?: string;
  reason?: string;
  result?: unknown;
}

/** No check could be made: the service is missing, refused the request, or failed. */
export class MastyfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MastyfUnavailableError';
  }
}

export function isBlocked(v: Verdict): boolean {
  return v.decision === 'block';
}

/**
 * What the model is told when a call or result is blocked. It names the check, never the text that
 * was matched: a blocked tool result was written by whoever controls that tool, so echoing it would
 * hand their words straight back to the model.
 */
export function modelMessage(v: Verdict): string {
  const parts = [v.layer, v.rule].filter(Boolean).join(': ');
  return parts ? `Blocked by Mastyf (${parts}).` : 'Blocked by Mastyf.';
}

export function parseVerdict(data: unknown): Verdict {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d['decision'] !== 'allow' && d['decision'] !== 'block' && d['decision'] !== 'redact') {
    throw new Error('not a verdict');
  }
  const v: Verdict = { decision: d['decision'], id: String(d['id'] ?? '') };
  for (const k of ['layer', 'rule', 'reason'] as const) if (typeof d[k] === 'string') v[k] = d[k] as string;
  if ('result' in d) v.result = d['result'];
  return v;
}
