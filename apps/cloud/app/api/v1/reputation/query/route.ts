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
    serverName,
    level: 'silver',
    consensusScore: 62,
    raterCount: 0,
    dimensions: {
      security_posture: 60,
      auth_strength: 55,
      cve_hygiene: 65,
      publisher_trust: 50,
      policy_compliance: 70,
      uptime: 60,
      community_rating: 55,
      guardian_protected: 80,
    },
    source: 'cloud-reputation-network',
  });
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
  const entry = upsertReputation(serverName, dimensions);
  return NextResponse.json({ ...entry, accepted: true });
}
