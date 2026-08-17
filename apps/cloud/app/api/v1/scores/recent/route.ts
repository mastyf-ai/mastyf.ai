import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
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

    let rows: CacheRow[];

    if (search) {
      const result = await db.execute(sql`
        SELECT package_name, version, scan_tier, score, level, grade,
               score_report, checks, computed_at, expires_at
        FROM package_score_cache
        WHERE expires_at > NOW()
          AND package_name ILIKE ${'%' + search + '%'}
        ORDER BY computed_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      rows = result as unknown as CacheRow[];
    } else {
      const result = await db.execute(sql`
        SELECT package_name, version, scan_tier, score, level, grade,
               score_report, checks, computed_at, expires_at
        FROM package_score_cache
        WHERE expires_at > NOW()
        ORDER BY computed_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      rows = result as unknown as CacheRow[];
    }

    const totalResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM package_score_cache WHERE expires_at > NOW()
    `);
    const totalRow = (totalResult as unknown as { cnt: string }[])[0];
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
