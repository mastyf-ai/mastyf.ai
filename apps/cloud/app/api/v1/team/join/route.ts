import { NextResponse, type NextRequest } from 'next/server';
import { isValidEmail, joinWithCode, normalizeEmail } from '@/lib/billing/workspace-seats';
import { checkTeamJoinRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const NO_MATCH = 'That email and code do not match an invitation. Check them, or ask your team lead to send a new code.';

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/**
 * POST /api/v1/team/join { email, code, name } — Shield's Join a team screen. Every way of getting
 * it wrong gets the same answer, so this can't be used to find out who has been invited.
 */
export async function POST(request: NextRequest) {
  try {
    const limit = await checkTeamJoinRateLimit(request);
    if (!limit.success) return fail('Too many tries. Wait a few minutes, then try again.', 429);

    const body = (await request.json().catch(() => null)) as { email?: unknown; code?: unknown; name?: unknown } | null;
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
    const code = typeof body?.code === 'string' ? body.code : '';
    if (!isValidEmail(email) || !code.trim()) return fail(NO_MATCH, 400);

    const joined = await joinWithCode({ email, code, name: body?.name });
    if (!joined.ok) {
      return joined.reason === 'plan_inactive'
        ? fail('This team’s plan is not active. Ask your team lead.', 402)
        : fail(NO_MATCH, 400);
    }
    return NextResponse.json(
      { licenseKey: joined.licenseKey, workspace: joined.workspace, name: joined.name },
      { headers: NO_STORE },
    );
  } catch {
    // Deliberately not logging the error: it could carry the code.
    console.error('[team/join] request failed');
    return fail('Could not join right now. Try again shortly.', 503);
  }
}
