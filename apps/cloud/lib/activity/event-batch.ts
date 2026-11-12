/**
 * Activity events sent by the `mastyf` command and the Shield app: one per tool call, tool result or
 * agent action, with the decision and a redacted snippet. Pure validation, no database imports.
 */

export const MAX_BATCH = 200;
export const SNIPPET_MAX = 300;
const REASON_MAX = 300;
const NAME_MAX = 128;
/** A client may hold events a while when offline; older than this is refused. */
const OLDEST_MS = 8 * 86_400_000;
const NEWEST_MS = 5 * 60_000;

export const DIRECTIONS = ['call', 'result', 'action'] as const;
export const VERDICTS = ['allow', 'block', 'flag', 'held'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export type Verdict = (typeof VERDICTS)[number];
export type Tier = 'free' | 'paid';

export type ActivityEvent = {
  id: string;
  occurredAt: string;
  agent: string | null;
  server: string;
  tool: string;
  direction: Direction;
  verdict: Verdict;
  rule: string | null;
  reason: string | null;
  latencyMs: number | null;
  fingerprint: string | null;
  snippet: string | null;
  sessionId: string | null;
};

export type ParsedBatch =
  | { ok: true; instanceId: string | null; events: ActivityEvent[] }
  | { ok: false; error: string };

/** The client redacts before sending; this second pass catches what a client missed. */
const SECRETS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi,
];

export function scrubSecrets(text: string): string {
  return SECRETS.reduce((out, re) => out.replace(re, '[REDACTED]'), text);
}

const ID = /^[A-Za-z0-9_-]{4,64}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parseOne(raw: unknown, now: number): ActivityEvent | string {
  if (!raw || typeof raw !== 'object') return 'event must be an object';
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || !ID.test(e.id)) return 'id must be 4-64 letters, digits, - or _';
  const at = typeof e.occurredAt === 'string' ? Date.parse(e.occurredAt) : NaN;
  if (!Number.isFinite(at)) return 'occurredAt must be an ISO time';
  if (at < now - OLDEST_MS || at > now + NEWEST_MS) return 'occurredAt is out of range';
  const server = text(e.server, NAME_MAX);
  const tool = text(e.tool, NAME_MAX);
  if (!server || !tool) return 'server and tool are required';
  const direction = (e.direction ?? 'call') as Direction;
  if (!DIRECTIONS.includes(direction)) return 'unknown direction';
  const verdict = e.verdict as Verdict;
  if (!VERDICTS.includes(verdict)) return 'unknown verdict';
  const latency = typeof e.latencyMs === 'number' && Number.isFinite(e.latencyMs) ? Math.round(e.latencyMs) : null;
  const fingerprint = typeof e.fingerprint === 'string' && /^[a-f0-9]{8,64}$/i.test(e.fingerprint) ? e.fingerprint : null;
  const snippet = text(e.snippet, SNIPPET_MAX * 4);
  const reason = text(e.reason, REASON_MAX * 4);
  return {
    id: e.id,
    occurredAt: new Date(at).toISOString(),
    agent: text(e.agent, 64),
    server,
    tool,
    direction,
    verdict,
    rule: text(e.rule, NAME_MAX),
    reason: reason ? scrubSecrets(reason).slice(0, REASON_MAX) : null,
    latencyMs: latency != null && latency >= 0 && latency <= 600_000 ? latency : null,
    fingerprint,
    snippet: snippet ? scrubSecrets(snippet).slice(0, SNIPPET_MAX) : null,
    sessionId: typeof e.sessionId === 'string' && ID.test(e.sessionId) ? e.sessionId : null,
  };
}

export function parseEventBatch(raw: unknown, now = Date.now()): ParsedBatch {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Body must be a JSON object' };
  const body = raw as Record<string, unknown>;
  const list = body.events;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'events must be a non-empty array' };
  if (list.length > MAX_BATCH) return { ok: false, error: `At most ${MAX_BATCH} events per batch` };
  const events: ActivityEvent[] = [];
  for (const [i, item] of list.entries()) {
    const parsed = parseOne(item, now);
    if (typeof parsed === 'string') return { ok: false, error: `events[${i}]: ${parsed}` };
    events.push(parsed);
  }
  const instanceId = typeof body.instanceId === 'string' && ID.test(body.instanceId) ? body.instanceId : null;
  return { ok: true, instanceId, events };
}

export function retentionDays(tier: Tier): number {
  return tier === 'paid' ? 365 : 7;
}
