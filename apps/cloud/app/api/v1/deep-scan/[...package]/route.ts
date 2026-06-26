import { NextResponse } from 'next/server';
import { extractBearerToken } from '@/lib/api-keys';
import { databaseUnavailableResponse } from '@/lib/cloud-db-guard';
import { deepScanQueueAvailable, enqueueDeepScan } from '@/lib/deep-scan-jobs';
import {
  InvalidPackageNameError,
  isDeepScanEnabled,
  PackageNotFoundError,
  resolvePackageScore,
} from '@/lib/package-score-resolver';
import { packagePathFromSegments } from '@/lib/trust-badge-svg';
import { computeTrustGrade, scoreToLevel } from '@/lib/trust-badge-grade';
import { resolveOrgFromApiKey } from '@/lib/org-context';
import { apiKeyHasScope } from '@/lib/org-rbac';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ package: string[] }> };

function scorePayload(score: Awaited<ReturnType<typeof resolvePackageScore>>) {
  return {
    ok: true,
    packageName: score.packageName,
    version: score.version,
    score: score.score,
    grade: computeTrustGrade(score.score),
    level: score.level || scoreToLevel(score.score),
    scanTier: score.scanTier,
    source: score.source,
    computedAt: score.computedAt,
    expiresAt: score.expiresAt,
  };
}

async function authorizeDeepScan(
  request: Request,
  requireAuth: boolean,
): Promise<
  | { ok: true; orgId: string | null }
  | { ok: false; response: NextResponse }
> {
  const bearer = extractBearerToken(request.headers.get('authorization'));
  if (!bearer) {
    if (!requireAuth) return { ok: true, orgId: null };
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'authorization_required', message: 'Bearer API key with deep-scan:run scope required' },
        { status: 401 },
      ),
    };
  }
  const ctx = await resolveOrgFromApiKey(bearer);
  if (!ctx) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid_api_key' }, { status: 401 }),
    };
  }
  if (!apiKeyHasScope(ctx.scopes, 'deep-scan:run')) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'insufficient_scope', required: 'deep-scan:run' }, { status: 403 }),
    };
  }
  return { ok: true, orgId: ctx.org.id };
}

export async function POST(request: Request, context: RouteContext) {
  const segments = (await context.params).package ?? [];
  const packageName = packagePathFromSegments(segments);

  if (!packageName) {
    return NextResponse.json({ error: 'package required' }, { status: 400 });
  }

  const auth = await authorizeDeepScan(request, !isDeepScanEnabled());
  if (!auth.ok) return auth.response;

  if (isDeepScanEnabled()) {
    try {
      const score = await resolvePackageScore(packageName, {
        tier: 'live',
        skipAttestation: true,
        forceRefresh: true,
      });
      return NextResponse.json(scorePayload(score));
    } catch (err: unknown) {
      if (err instanceof PackageNotFoundError || err instanceof InvalidPackageNameError) {
        return NextResponse.json({ error: 'package_not_found' }, { status: 404 });
      }
      const message = err instanceof Error ? err.message : 'deep_scan_failed';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (!deepScanQueueAvailable()) {
    return databaseUnavailableResponse();
  }

  try {
    const job = await enqueueDeepScan(packageName, auth.orgId);
    const base = new URL(request.url).origin;
    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        pollUrl: `${base}/api/v1/deep-scan/jobs/${job.id}`,
      },
      { status: 202 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'deep_scan_enqueue_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
