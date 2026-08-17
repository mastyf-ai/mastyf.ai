import { NextRequest, NextResponse } from 'next/server';
import { comparePackages } from '@/lib/score-compare';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const names = searchParams.getAll('package');

  if (names.length < 2) {
    return NextResponse.json(
      { error: 'Provide at least 2 ?package= params' },
      { status: 400 }
    );
  }

  try {
    const result = await comparePackages(names);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
