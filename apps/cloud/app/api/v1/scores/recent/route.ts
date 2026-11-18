import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { recentScoresQueries } from '@/lib/recent-scores';
import type { PublishableScoreReport } from '@/lib/score-report';
import { computeTrustGrade } from '@/lib/trust-badge-grade';

type CacheRow = {
  package_name: string;
  version: string;
  scan_tier: string;
  score: number;
  level: string;
  grade: string;
  score_report: PublishableScoreReport;
  checks: unknown[];
  computed_at: string;
  expires_at: string;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const search = searchParams.get('q')?.trim() || '';

    const db = getDb();

    // Every package ever scored, once each at its newest score; the card shows how old it is.
    const { list, count } = recentScoresQueries({ limit, offset, search: search || undefined });
    const rows = (await db.execute(list)) as unknown as CacheRow[];
    const totalRow = ((await db.execute(count)) as unknown as { cnt: string }[])[0];
    const total = parseInt(totalRow?.cnt || '0', 10);

    return NextResponse.json({
      packages: rows.map((r) => ({
        id: `${r.package_name}@${r.version}`,
        packageName: r.package_name,
        version: r.version,
        scanTier: r.scan_tier,
        score: r.score,
        grade: r.grade || computeTrustGrade(r.score),
        level: r.level,
        scoreReport: r.score_report,
        checks: r.checks,
        computedAt: r.computed_at,
        expiresAt: r.expires_at,
      })),
      total,
      offset,
      limit,
      hasMore: offset + rows.length < total,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}