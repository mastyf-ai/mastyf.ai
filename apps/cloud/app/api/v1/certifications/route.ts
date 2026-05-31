import { NextResponse } from 'next/server';
import { extractBearerToken } from '@/lib/api-keys';
import {
  listPublicCertifications,
  submitPublicCertification,
} from '@/lib/industry-standard';
import { resolveOrgFromApiKey } from '@/lib/org-context';
import { queryReputation, upsertReputation } from '@/lib/cloud-observatory-store';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const packageName = url.searchParams.get('package') ?? undefined;
  const limit = Number(url.searchParams.get('limit')) || 100;
  try {
    const certifications = await listPublicCertifications({ packageName, limit });
    const withReputation = certifications.map((c) => {
      const rep = queryReputation(c.serverName);
      return {
        ...c,
        reputation: rep ?? {
          consensusScore: c.score,
          level: c.level,
          raterCount: 1,
          source: 'certification-derived',
        },
      };
    });
    return NextResponse.json({ certifications: withReputation, count: withReputation.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'list_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let orgId: string | null = null;
  const bearer = extractBearerToken(request.headers.get('authorization'));
  if (bearer) {
    const ctx = await resolveOrgFromApiKey(bearer);
    if (!ctx) {
      return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 });
    }
    orgId = ctx.org.id;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const serverName = String(body.serverName || '').trim();
  const packageName = String(body.packageName || '').trim();
  const version = String(body.version || '').trim();
  const level = String(body.level || '').trim();
  const score = Number(body.score);
  const attestationJws = String(body.attestationJws || body.attestation || '').trim();

  if (!serverName || !packageName || !version || !level || !attestationJws) {
    return NextResponse.json(
      { error: 'serverName, packageName, version, level, attestationJws required' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(score)) {
    return NextResponse.json({ error: 'score must be a number' }, { status: 400 });
  }

  try {
    const result = await submitPublicCertification(orgId, {
      serverName,
      packageName,
      version,
      level,
      score,
      attestationJws,
      checks: Array.isArray(body.checks) ? body.checks : [],
      issuedAt: body.issuedAt ? String(body.issuedAt) : undefined,
      expiresAt: body.expiresAt ? String(body.expiresAt) : undefined,
    });
    upsertReputation(serverName, {
      security_posture: score,
      publisher_trust: score,
      policy_compliance: score,
      guardian_protected: 100,
    });
    return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'submit_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
