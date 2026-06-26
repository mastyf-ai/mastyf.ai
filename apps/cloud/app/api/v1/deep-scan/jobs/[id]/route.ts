import { NextResponse } from 'next/server';
import { extractBearerToken } from '@/lib/api-keys';
import { databaseUnavailableResponse } from '@/lib/cloud-db-guard';
import { deepScanQueueAvailable, getJob } from '@/lib/deep-scan-jobs';
import { resolveOrgFromApiKey } from '@/lib/org-context';
import { apiKeyHasScope } from '@/lib/org-rbac';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'job id required' }, { status: 400 });
  }

  const bearer = extractBearerToken(request.headers.get('authorization'));
  if (!bearer) {
    return NextResponse.json({ error: 'authorization_required' }, { status: 401 });
  }
  const ctx = await resolveOrgFromApiKey(bearer);
  if (!ctx || !apiKeyHasScope(ctx.scopes, 'deep-scan:run')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!deepScanQueueAvailable()) {
    return databaseUnavailableResponse();
  }

  const job = await getJob(id.trim());
  if (!job) {
    return NextResponse.json({ error: 'job_not_found' }, { status: 404 });
  }
  if (job.orgId && job.orgId !== ctx.org.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    jobId: job.id,
    packageName: job.packageName,
    status: job.status,
    result: job.resultJson,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    pollUrl: new URL(`/api/v1/deep-scan/jobs/${job.id}`, request.url).toString(),
  });
}
