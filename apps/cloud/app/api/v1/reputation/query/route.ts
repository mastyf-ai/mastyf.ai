import { NextResponse } from 'next/server';
import { queryReputation, upsertReputation } from '../../../../../lib/cloud-observatory-store';

/** B1 — Query decentralized server reputation (cloud consensus view). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const serverName = url.searchParams.get('server') ?? '';
  if (!serverName) {
    return NextResponse.json({ error: 'server query param required' }, { status: 400 });
  }
  const stored = queryReputation(serverName);
  if (stored) {
    return NextResponse.json({ ...stored, source: 'cloud-reputation-network' });
  }
  return NextResponse.json({
    found: false,
    available: false,
    serverName,
    reason: 'reputation_not_found',
    dataSources: [],
    source: 'cloud-reputation-network',
  }, { status: 404 });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const serverName = String(body.serverName ?? '');
  const dimensions = (body.dimensions ?? {}) as Record<string, number>;
  if (!serverName) {
    return NextResponse.json({ error: 'serverName required' }, { status: 400 });
  }
  if (!Object.values(dimensions).some((value) => Number.isFinite(value))) {
    return NextResponse.json({ error: 'dimensions with finite values required' }, { status: 400 });
  }
  const entry = upsertReputation(serverName, dimensions);
  return NextResponse.json({ ...entry, accepted: true });
}
