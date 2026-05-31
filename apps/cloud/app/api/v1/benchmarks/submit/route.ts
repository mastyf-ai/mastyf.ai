import { extractBearerToken } from '@/lib/api-keys';
import { submitPublicBenchmark } from '@/lib/industry-standard';
import { resolveOrgFromApiKey } from '@/lib/org-context';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  let orgId: string | null = null;
  const bearer = extractBearerToken(request.headers.get('authorization'));
  if (bearer) {
    const ctx = await resolveOrgFromApiKey(bearer);
    if (ctx) orgId = ctx.org.id;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const profile = String(body.profile || '').trim();
  const blockRate = Number(body.blockRate);
  const falsePositiveRate = Number(body.falsePositiveRate);

  if (!profile) {
    return NextResponse.json({ error: 'profile required' }, { status: 400 });
  }
  if (!Number.isFinite(blockRate) || !Number.isFinite(falsePositiveRate)) {
    return NextResponse.json(
      { error: 'blockRate and falsePositiveRate must be numbers' },
      { status: 400 },
    );
  }

  try {
    const result = await submitPublicBenchmark(orgId, {
      profile,
      packageName: body.packageName ? String(body.packageName) : undefined,
      blockRate,
      falsePositiveRate,
      p95LatencyMs: body.p95LatencyMs != null ? Number(body.p95LatencyMs) : undefined,
      scorecard:
        body.scorecard && typeof body.scorecard === 'object'
          ? (body.scorecard as Record<string, unknown>)
          : {},
      guardianVersion: body.guardianVersion ? String(body.guardianVersion) : undefined,
    });
    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'submit_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
