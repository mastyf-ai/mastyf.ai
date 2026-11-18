/**
 * The queries behind the Certified list: every package that has ever been scored, once each at its
 * newest score, newest first. Expired scores stay listed (the card shows how old the score is);
 * opening a package re-scores it.
 */
import { sql, type SQL } from 'drizzle-orm';

export function recentScoresQueries(opts: { limit: number; offset: number; search?: string }): { list: SQL; count: SQL } {
  const match = opts.search ? sql`WHERE package_name ILIKE ${'%' + opts.search + '%'}` : sql``;
  const list = sql`
    SELECT * FROM (
      SELECT DISTINCT ON (package_name)
             package_name, version, scan_tier, score, level, grade,
             score_report, checks, computed_at, expires_at
      FROM package_score_cache
      ${match}
      ORDER BY package_name, computed_at DESC
    ) newest
    ORDER BY computed_at DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `;
  const count = sql`SELECT COUNT(DISTINCT package_name) AS cnt FROM package_score_cache ${match}`;
  return { list, count };
}
