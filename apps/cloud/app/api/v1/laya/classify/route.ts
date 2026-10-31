import { NextResponse } from 'next/server';
import { extractBearerToken, isWellFormedApiKey } from '@/lib/api-keys';
import { parseClassifyBody } from '@/lib/laya/classify-request';
import { resolveLayaTarget } from '@/lib/laya/deployment';
import { forwardToLaya } from '@/lib/laya/forward';
import { resolveOrgFromApiKey } from '@/lib/org-context';
import { checkLayaRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const preferredRegion = 'iad1';
export const dynamic = 'force-dynamic';

function error(status: number, message: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ error: message }, { status, headers });
}

/**
 * Laya verdict for one undecided MCP call. The workspace comes only from the API key; anything
 * in the body, query or headers that names a workspace is ignored. The state and the key are never
 * logged, stored or echoed, and error bodies never carry upstream text.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token || !isWellFormedApiKey(token)) return error(401, 'Unauthorized');
    const resolved = await resolveOrgFromApiKey(token);
    if (!resolved) return error(401, 'Unauthorized');
    if (!resolved.scopes.includes('laya:classify')) return error(403, 'Forbidden');

    const orgId = resolved.org.id;
    const limit = await checkLayaRateLimit(orgId);
    if (!limit.success) {
      return error(429, 'Rate limit exceeded', { 'Retry-After': String(limit.retryAfter) });
    }

    const target = await resolveLayaTarget(orgId);
    if (target.kind === 'self_hosted') {
      return error(403, 'This workspace runs Laya on its own infrastructure');
    }
    if (target.kind === 'unavailable') return error(503, 'Laya unavailable');

    const parsed = parseClassifyBody(await request.text());
    if (!parsed.ok) return error(400, 'Invalid request');

    const verdict = await forwardToLaya({ endpoint: target.endpoint, secret: target.secret }, parsed.state);
    if (!verdict.ok) return error(503, 'Laya unavailable');

    return NextResponse.json(
      { answers: { verdict: { choice: verdict.choice, answer_confidence: verdict.confidence } } },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    // Deliberately not logging the error: it may carry the key or the state.
    console.error('[laya/classify] request failed');
    return error(503, 'Laya unavailable');
  }
}
