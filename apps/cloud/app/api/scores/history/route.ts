import { NextRequest, NextResponse } from 'next/server';
import { recordScoreEntry, detectScoreChange, generateAlerts } from '@/lib/score-history';
import { resolvePackageScore } from '@/lib/package-score-resolver';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const packageName = searchParams.get('package');

  if (!packageName) {
    return NextResponse.json(
      { error: 'Provide ?package=' },
      { status: 400 }
    );
  }

  try {
    const score = await resolvePackageScore(packageName);
    return NextResponse.json({
      current: {
        package_name: score.packageName,
        score: score.score,
        grade: score.grade,
        level: score.level,
        computed_at: score.computedAt,
      },
      history: [],
      alerts: [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
