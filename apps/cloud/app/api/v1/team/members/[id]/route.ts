import { NextResponse } from 'next/server';
import { inviteEmail } from '@/lib/billing/invite-email';
import { fail, lookUpLead, NO_STORE, refuse, SITE_URL } from '@/lib/billing/team-api';
import { prepareNewCode, removeSeat, storeSeatCode } from '@/lib/billing/workspace-seats';
import { emailConfigured, sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

const CODE_ERRORS = {
  no_team_plan: ['Sending codes needs an active Team plan.', 402],
  not_found: ['That person is not in this workspace.', 404],
  cooldown: ['A code was sent a moment ago. Wait a minute, then try again.', 429],
} as const;

type Context = { params: Promise<{ id: string }> };

/** DELETE /api/v1/team/members/:id — removes the person and stops their key. */
export async function DELETE(request: Request, { params }: Context) {
  try {
    const found = await lookUpLead(request);
    if (!found.ok) return refuse(found.reason);
    const { id } = await params;
    if (!(await removeSeat(found.lead.orgId, id))) return fail('That person is not in this workspace.', 404);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    console.error('[team] could not remove a member');
    return fail('Could not remove that person. Try again shortly.', 500);
  }
}

/** POST /api/v1/team/members/:id — emails a new code. Also how a member moves to another computer. */
export async function POST(request: Request, { params }: Context) {
  try {
    const found = await lookUpLead(request);
    if (!found.ok) return refuse(found.reason);
    const { lead } = found;
    const { id } = await params;
    if (!emailConfigured()) return fail('Email is not set up yet, so codes cannot be sent.', 503);

    const next = await prepareNewCode(lead.orgId, id);
    if (!next.ok) {
      const [message, status] = CODE_ERRORS[next.reason];
      return fail(message, status);
    }

    const sent = await sendEmail(
      inviteEmail({
        to: next.email,
        code: next.code,
        leadName: lead.name || lead.email,
        workspace: lead.orgName,
        siteUrl: SITE_URL,
      }),
    );
    if (!sent) return fail('We could not send the email. The earlier code still works.', 502);

    await storeSeatCode(id, next.email, next.code);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    console.error('[team] could not send a new code');
    return fail('Could not send a new code. Try again shortly.', 500);
  }
}
