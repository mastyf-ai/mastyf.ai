import { NextResponse } from 'next/server';
import { inviteEmail } from '@/lib/billing/invite-email';
import { prepareNewCode, removeSeat, storeSeatCode } from '@/lib/billing/workspace-seats';
import { emailConfigured, sendEmail } from '@/lib/email';
import { getUserOrg, userCanManageOrg } from '@/lib/org-context';
import { safeAuth } from '@/lib/safe-auth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mastyf.ai').replace(/\/$/, '');

const CODE_ERRORS = {
  no_team_plan: ['Sending codes needs an active Team plan.', 402],
  not_found: ['That person is not in this workspace.', 404],
  cooldown: ['A code was sent a moment ago. Wait a minute, then try again.', 429],
} as const;

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/** The signed-in owner or admin and their workspace, or the response that refuses them. */
async function lead() {
  const session = await safeAuth();
  const userId = session?.user?.id;
  if (!userId) return { refused: fail('Sign in first.', 401) };
  const ctx = await getUserOrg(userId);
  if (!ctx) return { refused: fail('Your workspace is still being set up.', 409) };
  if (!userCanManageOrg(ctx.membership)) return { refused: fail('Only a workspace owner or admin can do this.', 403) };
  return { session, ctx };
}

type Context = { params: Promise<{ id: string }> };

/** DELETE /api/team/members/:id — removes the person and stops their key. */
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const who = await lead();
    if (who.refused) return who.refused;
    const { id } = await params;
    if (!(await removeSeat(who.ctx.org.id, id))) return fail('That person is not in this workspace.', 404);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    console.error('[team] could not remove a member');
    return fail('Could not remove that person. Try again shortly.', 500);
  }
}

/** POST /api/team/members/:id — emails a new code. Also how a member moves to another computer. */
export async function POST(_request: Request, { params }: Context) {
  try {
    const who = await lead();
    if (who.refused) return who.refused;
    const { id } = await params;
    if (!emailConfigured()) return fail('Email is not set up on this site yet, so codes cannot be sent.', 503);

    const next = await prepareNewCode(who.ctx.org.id, id);
    if (!next.ok) {
      const [message, status] = CODE_ERRORS[next.reason];
      return fail(message, status);
    }

    const sent = await sendEmail(
      inviteEmail({
        to: next.email,
        code: next.code,
        leadName: who.session.user.name || who.session.user.email || 'Your team lead',
        workspace: who.ctx.org.name,
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
