import { NextResponse } from 'next/server';
import { inviteEmail } from '@/lib/billing/invite-email';
import { addSeat, isValidEmail, normalizeEmail, removeSeat } from '@/lib/billing/workspace-seats';
import { emailConfigured, sendEmail } from '@/lib/email';
import { getUserOrg, userCanManageOrg } from '@/lib/org-context';
import { checkTeamInviteRateLimit } from '@/lib/rate-limit';
import { safeAuth } from '@/lib/safe-auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mastyf.ai').replace(/\/$/, '');

const ADD_ERRORS = {
  no_team_plan: ['Adding people needs an active Team plan.', 402],
  is_lead: ['That is your own email. You are already in this workspace.', 400],
  full: ['All seats are in use. Remove someone to add another person.', 409],
  already_added: ['That person has already been added.', 409],
} as const;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/** POST /api/team/members { email } — a Team lead adds a person. The code goes only to that inbox. */
export async function POST(request: Request) {
  const session = await safeAuth();
  const userId = session?.user?.id;
  if (!userId) return fail('Sign in to add people.', 401);

  try {
    const ctx = await getUserOrg(userId);
    if (!ctx) return fail('Your workspace is still being set up. Open the dashboard, then try again.', 409);
    if (!userCanManageOrg(ctx.membership)) return fail('Only a workspace owner or admin can add people.', 403);

    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
    if (!isValidEmail(email)) return fail('Enter a valid email address.', 400);
    if (!emailConfigured()) return fail('Email is not set up on this site yet, so invitations cannot be sent.', 503);

    const limit = await checkTeamInviteRateLimit(ctx.org.id);
    if (!limit.success) return fail('Too many invitations. Try again later.', 429);

    const added = await addSeat({
      orgId: ctx.org.id,
      email,
      invitedBy: userId,
      leadEmail: normalizeEmail(session.user.email ?? ''),
    });
    if (!added.ok) {
      const [message, status] = ADD_ERRORS[added.reason];
      return fail(message, status);
    }

    const sent = await sendEmail(
      inviteEmail({
        to: email,
        code: added.code,
        leadName: session.user.name || session.user.email || 'Your team lead',
        workspace: ctx.org.name,
        siteUrl: SITE_URL,
      }),
    );
    if (!sent) {
      await removeSeat(ctx.org.id, added.seatId);
      return fail('We could not send the email, so nobody was added. Check the address and try again.', 502);
    }

    return NextResponse.json({ ok: true, seat: { id: added.seatId, email } }, { headers: NO_STORE });
  } catch {
    console.error('[team] could not add a member');
    return fail('Could not add that person. Try again shortly.', 500);
  }
}
