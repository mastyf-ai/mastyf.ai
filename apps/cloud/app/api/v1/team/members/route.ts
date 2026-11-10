import { NextResponse } from 'next/server';
import { inviteEmail } from '@/lib/billing/invite-email';
import { fail, lookUpLead, NO_STORE, refuse, SITE_URL } from '@/lib/billing/team-api';
import { addSeat, isValidEmail, listSeats, normalizeEmail, removeSeat, seatOverview } from '@/lib/billing/workspace-seats';
import { emailConfigured, sendEmail } from '@/lib/email';
import { checkTeamInviteRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const ADD_ERRORS = {
  no_team_plan: ['Adding people needs an active Team plan.', 402],
  is_lead: ['That is your own email. You are already in this workspace.', 400],
  full: ['All seats are in use. Remove someone to add another person.', 409],
  already_added: ['That person has already been added.', 409],
} as const;

/** GET /api/v1/team/members — what Shield shows a lead. Anyone else is told only `allowed: false`. */
export async function GET(request: Request) {
  try {
    const found = await lookUpLead(request);
    if (!found.ok) {
      return found.reason === 'bad_key'
        ? refuse(found.reason)
        : NextResponse.json({ allowed: false }, { headers: NO_STORE });
    }
    const { lead } = found;
    const overview = await seatOverview(lead.orgId);
    if (!overview.allowed) return NextResponse.json({ allowed: false }, { headers: NO_STORE });
    return NextResponse.json(
      {
        allowed: true,
        workspace: lead.orgName,
        leadEmail: lead.email,
        maxPeople: overview.maxPeople,
        seats: await listSeats(lead.orgId),
      },
      { headers: NO_STORE },
    );
  } catch {
    console.error('[team] could not list members');
    return fail('Could not load your team. Try again shortly.', 500);
  }
}

/** POST /api/v1/team/members { email } — a lead adds a person. The code goes only to that inbox. */
export async function POST(request: Request) {
  try {
    const found = await lookUpLead(request);
    if (!found.ok) return refuse(found.reason);
    const { lead } = found;

    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
    if (!isValidEmail(email)) return fail('Enter a valid email address.', 400);
    if (!emailConfigured()) return fail('Email is not set up yet, so invitations cannot be sent.', 503);

    const limit = await checkTeamInviteRateLimit(lead.orgId);
    if (!limit.success) return fail('Too many invitations. Try again later.', 429);

    const added = await addSeat({ orgId: lead.orgId, email, invitedBy: lead.userId, leadEmail: lead.email });
    if (!added.ok) {
      const [message, status] = ADD_ERRORS[added.reason];
      return fail(message, status);
    }

    const sent = await sendEmail(
      inviteEmail({
        to: email,
        code: added.code,
        leadName: lead.name || lead.email,
        workspace: lead.orgName,
        siteUrl: SITE_URL,
      }),
    );
    if (!sent) {
      await removeSeat(lead.orgId, added.seatId);
      return fail('We could not send the email, so nobody was added. Check the address and try again.', 502);
    }

    return NextResponse.json({ ok: true, seat: { id: added.seatId, email } }, { headers: NO_STORE });
  } catch {
    console.error('[team] could not add a member');
    return fail('Could not add that person. Try again shortly.', 500);
  }
}
