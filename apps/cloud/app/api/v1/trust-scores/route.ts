import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function GET(req: Request) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const pkg = searchParams.get('package');
  if (!pkg) return NextResponse.json({ error: 'package required' }, { status: 400 });

  const result: any = await db.execute(sql`
    SELECT * FROM public_trust_scores WHERE package_name = ${pkg}
  `);
  const rows = result?.rows || [];
  if (rows.length === 0) {
    return NextResponse.json({ found: false, packageName: pkg });
  }

  const r = rows[0];
  return NextResponse.json({
    found: true,
    packageName: r.package_name,
    trustScore: r.trust_score,
    trustGrade: r.trust_grade,
    dimensions: (r.dimensions || {}),
    cveCount: r.cve_count,
    criticalCveCount: r.critical_cve_count,
    scannedAt: r.scanned_at,
    reportCount: r.report_count,
  });
}

export async function POST(req: Request) {
  const db = getDb();
  const body = await req.json();
  const { packageName, trustScore, trustGrade, dimensions, cveCount, criticalCveCount } = body;

  if (!packageName || trustScore == null || !trustGrade) {
    return NextResponse.json({ error: 'packageName, trustScore, and trustGrade required' }, { status: 400 });
  }

  await db.execute(sql`
    INSERT INTO public_trust_scores (package_name, trust_score, trust_grade, dimensions, cve_count, critical_cve_count)
    VALUES (${packageName}, ${trustScore}, ${trustGrade}, ${JSON.stringify(dimensions || {})}, ${cveCount || 0}, ${criticalCveCount || 0})
    ON CONFLICT (package_name) DO UPDATE SET
      trust_score = ${trustScore}, trust_grade = ${trustGrade},
      dimensions = ${JSON.stringify(dimensions || {})},
      cve_count = ${cveCount || 0}, critical_cve_count = ${criticalCveCount || 0},
      scanned_at = NOW(), report_count = public_trust_scores.report_count + 1
  `);

  return NextResponse.json({ ok: true });
}
