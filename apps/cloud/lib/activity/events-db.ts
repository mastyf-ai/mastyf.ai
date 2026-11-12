import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { rowsOf } from '@/lib/dashboard-shared';
import { retentionDays, type ActivityEvent, type Tier } from './event-batch';

/** Whose records these are. `memberEmail` is set for a Team member's key. */
export type EventOwner = { ownerId: string; tier: Tier; memberEmail: string | null };

export type StoredEvent = ActivityEvent & { instanceId: string | null; memberEmail: string | null };

/** Stores a batch; an id already stored for this owner is skipped. Returns how many were new. */
export async function insertEvents(owner: EventOwner, instanceId: string | null, events: ActivityEvent[]): Promise<number> {
  let stored = 0;
  const db = getDb();
  for (const e of events) {
    const result = await db.execute(sql`
      INSERT INTO activity_events (
        owner_id, id, tier, member_email, instance_id, agent, server, tool, direction, verdict,
        rule, reason, latency_ms, fingerprint, snippet, session_id, occurred_at
      ) VALUES (
        ${owner.ownerId}, ${e.id}, ${owner.tier}, ${owner.memberEmail}, ${instanceId}, ${e.agent}, ${e.server},
        ${e.tool}, ${e.direction}, ${e.verdict}, ${e.rule}, ${e.reason}, ${e.latencyMs}, ${e.fingerprint},
        ${e.snippet}, ${e.sessionId}, ${e.occurredAt}
      )
      ON CONFLICT (owner_id, id) DO NOTHING
      RETURNING id
    `);
    stored += rowsOf(result).length;
  }
  return stored;
}

/** Deletes this owner's records older than their plan keeps. */
export async function pruneEvents(owner: EventOwner): Promise<void> {
  await getDb().execute(sql`
    DELETE FROM activity_events
    WHERE owner_id = ${owner.ownerId}
      AND occurred_at < now() - make_interval(days => ${retentionDays(owner.tier)})
  `);
}

export type EventTotals = { total: number; blocked: number; flagged: number; lastAt: string | null };

/** Counts over the whole window, not just the rows a page shows. */
export async function countEvents(ownerId: string, days: number): Promise<EventTotals> {
  const [row] = rowsOf<{ total: unknown; blocked: unknown; flagged: unknown; last_at: string | Date | null }>(
    await getDb().execute(sql`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE verdict = 'block') AS blocked,
             count(*) FILTER (WHERE verdict IN ('flag', 'held')) AS flagged,
             max(occurred_at) AS last_at
      FROM activity_events
      WHERE owner_id = ${ownerId} AND occurred_at >= now() - make_interval(days => ${days})
    `),
  );
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    total: n(row?.total),
    blocked: n(row?.blocked),
    flagged: n(row?.flagged),
    lastAt: row?.last_at ? new Date(row.last_at).toISOString() : null,
  };
}

type Row = {
  id: string;
  occurred_at: string | Date;
  member_email: string | null;
  instance_id: string | null;
  agent: string | null;
  server: string;
  tool: string;
  direction: ActivityEvent['direction'];
  verdict: ActivityEvent['verdict'];
  rule: string | null;
  reason: string | null;
  latency_ms: number | null;
  fingerprint: string | null;
  snippet: string | null;
  session_id: string | null;
};

/** Newest first. `memberEmail` limits the list to one person's records. */
export async function listEvents(
  ownerId: string,
  opts: { memberEmail?: string | null; days: number; limit: number; before?: string | null },
): Promise<StoredEvent[]> {
  const rows = rowsOf<Row>(
    await getDb().execute(sql`
      SELECT id, occurred_at, member_email, instance_id, agent, server, tool, direction, verdict,
             rule, reason, latency_ms, fingerprint, snippet, session_id
      FROM activity_events
      WHERE owner_id = ${ownerId}
        AND occurred_at >= now() - make_interval(days => ${opts.days})
        ${opts.memberEmail ? sql`AND member_email = ${opts.memberEmail}` : sql``}
        ${opts.before ? sql`AND occurred_at < ${opts.before}` : sql``}
      ORDER BY occurred_at DESC
      LIMIT ${opts.limit}
    `),
  );
  return rows.map((r) => ({
    id: r.id,
    occurredAt: new Date(r.occurred_at).toISOString(),
    memberEmail: r.member_email,
    instanceId: r.instance_id,
    agent: r.agent,
    server: r.server,
    tool: r.tool,
    direction: r.direction,
    verdict: r.verdict,
    rule: r.rule,
    reason: r.reason,
    latencyMs: r.latency_ms,
    fingerprint: r.fingerprint,
    snippet: r.snippet,
    sessionId: r.session_id,
  }));
}
