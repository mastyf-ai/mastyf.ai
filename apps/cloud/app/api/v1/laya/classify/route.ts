import { NextResponse } from 'next/server';
import { extractBearerToken, extractRawBearerToken, isWellFormedApiKey } from '@/lib/api-keys';
import { deviceDecision, DEVICE_LIMIT_MESSAGE, entitlementActive, findIssuedEntitlement } from '@/lib/billing/license-keys';
import { parseClassifyBody } from '@/lib/laya/classify-request';
import { resolveLayaTarget, sharedTarget, type LayaTarget } from '@/lib/laya/deployment';
import { forwardToLaya } from '@/lib/laya/forward';
import { workspaceHasProtocolX } from '@/lib/laya/plan';
import { resolveOrgFromApiKey } from '@/lib/org-context';
import { checkLayaRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const preferredRegion = 'hnd1';
export const dynamic = 'force-dynamic';

const LICENSE_KEY_PREFIX = 'MG-';

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
    const authorization = request.headers.get('authorization');
    const raw = extractRawBearerToken(authorization);
    let limitKey: string;
    let target: LayaTarget;

    if (raw?.startsWith(LICENSE_KEY_PREFIX)) {
      // The desktop app holds a license key rather than a workspace key.
      const entitlement = await findIssuedEntitlement(raw);
      if (!entitlement) return error(401, 'Unauthorized');
      if (!entitlementActive(entitlement)) return error(402, 'Protocol X requires a paid plan');
      // A one-device key answers only on the device it was activated on.
      const device = request.headers.get('x-mastyf-device')?.trim() ?? '';
      if (deviceDecision(entitlement, device) !== 'allow') return error(403, DEVICE_LIMIT_MESSAGE);
      limitKey = `license-${entitlement.id}`;
      const limit = await checkLayaRateLimit(limitKey);
      if (!limit.success) {
        return error(429, 'Rate limit exceeded', { 'Retry-After': String(limit.retryAfter) });
      }
      target = sharedTarget();
    } else {
      const token = extractBearerToken(authorization);
      if (!token || !isWellFormedApiKey(token)) return error(401, 'Unauthorized');
      const resolved = await resolveOrgFromApiKey(token);
      if (!resolved) return error(401, 'Unauthorized');
      if (!resolved.scopes.includes('laya:classify')) return error(403, 'Forbidden');

      const orgId = resolved.org.id;
      if (!(await workspaceHasProtocolX(orgId))) return error(402, 'Protocol X requires a paid plan');

      const limit = await checkLayaRateLimit(orgId);
      if (!limit.success) {
        return error(429, 'Rate limit exceeded', { 'Retry-After': String(limit.retryAfter) });
      }

      target = await resolveLayaTarget(orgId);
    }
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
