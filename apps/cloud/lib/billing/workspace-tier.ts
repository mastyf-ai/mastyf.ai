import { sql } from 'drizzle-orm';
import { rowsOf } from '../dashboard-shared';
import { getDb } from '../db';

/**
 * The workspace's current tier, for routes on a tight time budget: no license, or an expired or revoked
 * one, reads as free. A database failure throws, so callers can't mistake it for free or paid.
 */
export async function workspaceTier(orgId: string): Promise<string> {
  const [row] = rowsOf<{ tier: unknown }>(
    await getDb().execute(sql`
      SELECT tier FROM licenses WHERE org_id = ${orgId} AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY activated_at DESC LIMIT 1
    `),
  );
  return row ? String(row.tier ?? 'free').toLowerCase() : 'free';
}
