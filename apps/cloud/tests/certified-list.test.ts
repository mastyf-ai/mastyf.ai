import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { recentScoresQueries } from '@/lib/recent-scores';
import { freshnessLabel } from '@/lib/freshness';

const dialect = new PgDialect();
const render = (q: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(q);

describe('the Certified list', () => {
  it('shows every package ever scored, not only scores that have not expired', () => {
    const { list, count } = recentScoresQueries({ limit: 24, offset: 0 });
    for (const q of [list, count]) {
      expect(render(q).sql).not.toMatch(/expires_at\s*>\s*NOW\(\)/i);
    }
  });

  it('shows each package once, at its newest score, newest first', () => {
    const sql = render(recentScoresQueries({ limit: 24, offset: 0 }).list).sql;
    expect(sql).toMatch(/DISTINCT ON \(package_name\)/i);
    expect(sql).toMatch(/ORDER BY computed_at DESC/i);
  });

  it('counts only what the search matches, so the page count is right', () => {
    const { list, count } = recentScoresQueries({ limit: 24, offset: 0, search: 'filesystem' });
    for (const q of [list, count]) {
      const { sql, params } = render(q);
      expect(sql).toMatch(/ILIKE/i);
      expect(params).toContain('%filesystem%');
    }
    expect(render(recentScoresQueries({ limit: 24, offset: 0 }).count).sql).not.toMatch(/ILIKE/i);
  });
});

describe('how old a score is', () => {
  it.each([
    [0, 'Updated today'],
    [5, 'Updated 5d ago'],
    [20, 'Updated 2w ago'],
    [60, 'Updated 2mo ago'],
    [200, 'Updated 6mo ago'],
    [400, 'Updated 1y ago'],
  ])('%i days → %s', (days, label) => {
    expect(freshnessLabel(days)).toBe(label);
  });
});
