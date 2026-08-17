import { NextRequest, NextResponse } from 'next/server';
import { getScoreHistory, getCurrentScore } from '@/lib/score-history';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const packageName = searchParams.get('package');
  const days = parseInt(searchParams.get('days') || '30', 10);

  if (!packageName) {
    return NextResponse.json(
      { error: 'Provide ?package=' },
      { status: 400 }
    );
  }

  try {
    const [current, history] = await Promise.all([
      getCurrentScore(packageName),
      getScoreHistory(packageName, days),
    ]);

    return NextResponse.json({ current, history });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
