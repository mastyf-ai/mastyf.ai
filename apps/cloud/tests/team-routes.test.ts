import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  safeAuth: vi.fn(),
  getUserOrg: vi.fn(),
  addSeat: vi.fn(),
  removeSeat: vi.fn(),
  prepareNewCode: vi.fn(),
  storeSeatCode: vi.fn(),
  joinWithCode: vi.fn(),
  sendEmail: vi.fn(),
  emailConfigured: vi.fn(),
  invite: vi.fn(),
  join: vi.fn(),
}));

vi.mock('@/lib/safe-auth', () => ({ safeAuth: m.safeAuth }));
vi.mock('@/lib/org-context', () => ({
  getUserOrg: m.getUserOrg,
  userCanManageOrg: (x: { role: string }) => x.role === 'owner' || x.role === 'admin',
}));
vi.mock('@/lib/email', () => ({ sendEmail: m.sendEmail, emailConfigured: m.emailConfigured }));
vi.mock('@/lib/rate-limit', () => ({ checkTeamInviteRateLimit: m.invite, checkTeamJoinRateLimit: m.join }));
vi.mock('@/lib/billing/workspace-seats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/workspace-seats')>()),
  addSeat: m.addSeat,
  removeSeat: m.removeSeat,
  prepareNewCode: m.prepareNewCode,
  storeSeatCode: m.storeSeatCode,
  joinWithCode: m.joinWithCode,
}));

import { POST as add } from '@/app/api/team/members/route';
import { DELETE as remove, POST as resend } from '@/app/api/team/members/[id]/route';
import { POST as join } from '@/app/api/v1/team/join/route';

const CODE = 'ABCD-2345';
const post = (body: unknown) =>
  new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const OWNER = { org: { id: 'org-1', name: 'Acme' }, membership: { role: 'owner' } };

beforeEach(() => {
  vi.resetAllMocks();
  m.safeAuth.mockResolvedValue({ user: { id: 'u1', name: 'Ada', email: 'ada@example.com' } });
  m.getUserOrg.mockResolvedValue(OWNER);
  m.emailConfigured.mockReturnValue(true);
  m.sendEmail.mockResolvedValue(true);
  m.invite.mockResolvedValue({ success: true });
  m.join.mockResolvedValue({ success: true });
  m.addSeat.mockResolvedValue({ ok: true, seatId: 'seat-1', code: CODE });
});

describe('adding a member', () => {
  const addP = (email = 'Prabhat@Example.com') => add(post({ email }));

  it('is 401 when nobody is signed in', async () => {
    m.safeAuth.mockResolvedValue(null);
    expect((await addP()).status).toBe(401);
    expect(m.addSeat).not.toHaveBeenCalled();
  });

  it('is only for workspace owners and admins', async () => {
    m.getUserOrg.mockResolvedValue({ ...OWNER, membership: { role: 'viewer' } });
    expect((await addP()).status).toBe(403);
    expect(m.addSeat).not.toHaveBeenCalled();
  });

  it('refuses something that is not an email address', async () => {
    expect((await addP('not-an-email')).status).toBe(400);
    expect(m.addSeat).not.toHaveBeenCalled();
  });

  it('says so when email is not set up, without adding anyone', async () => {
    m.emailConfigured.mockReturnValue(false);
    expect((await addP()).status).toBe(503);
    expect(m.addSeat).not.toHaveBeenCalled();
  });

  it('is limited per workspace', async () => {
    m.invite.mockResolvedValue({ success: false, retryAfter: 30 });
    expect((await addP()).status).toBe(429);
    expect(m.addSeat).not.toHaveBeenCalled();
  });

  it('adds to the signed-in lead’s own workspace, and emails the code to that person', async () => {
    const res = await addP();
    expect(res.status).toBe(200);
    expect(m.addSeat).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', email: 'prabhat@example.com', invitedBy: 'u1', leadEmail: 'ada@example.com' }),
    );
    const mail = m.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('prabhat@example.com');
    expect(mail.text).toContain(CODE);
  });

  it('never shows the code to the lead', async () => {
    expect(await (await addP()).text()).not.toContain(CODE);
  });

  it.each([
    ['no_team_plan', 402],
    ['is_lead', 400],
    ['full', 409],
    ['already_added', 409],
  ])('answers %s with %i and sends nothing', async (reason, status) => {
    m.addSeat.mockResolvedValue({ ok: false, reason });
    expect((await addP()).status).toBe(status);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('adds nobody when the email cannot be sent', async () => {
    m.sendEmail.mockResolvedValue(false);
    expect((await addP()).status).toBe(502);
    expect(m.removeSeat).toHaveBeenCalledWith('org-1', 'seat-1');
  });
});

describe('removing a member', () => {
  it('is only for workspace owners and admins', async () => {
    m.getUserOrg.mockResolvedValue({ ...OWNER, membership: { role: 'viewer' } });
    expect((await remove(post({}), params('seat-1'))).status).toBe(403);
    expect(m.removeSeat).not.toHaveBeenCalled();
  });

  it('only reaches into the lead’s own workspace', async () => {
    m.removeSeat.mockResolvedValue(true);
    expect((await remove(post({}), params('seat-1'))).status).toBe(200);
    expect(m.removeSeat).toHaveBeenCalledWith('org-1', 'seat-1');
  });

  it('is 404 for a seat that is not in this workspace', async () => {
    m.removeSeat.mockResolvedValue(false);
    expect((await remove(post({}), params('other'))).status).toBe(404);
  });
});

describe('sending a new code', () => {
  beforeEach(() => {
    m.prepareNewCode.mockResolvedValue({ ok: true, email: 'p@example.com', code: CODE });
  });

  it('is only for workspace owners and admins', async () => {
    m.getUserOrg.mockResolvedValue({ ...OWNER, membership: { role: 'viewer' } });
    expect((await resend(post({}), params('seat-1'))).status).toBe(403);
  });

  it('emails the code and never returns it', async () => {
    const res = await resend(post({}), params('seat-1'));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(CODE);
    expect(m.prepareNewCode).toHaveBeenCalledWith('org-1', 'seat-1');
    expect(m.storeSeatCode).toHaveBeenCalledWith('seat-1', 'p@example.com', CODE);
  });

  it('keeps the old code working if the email fails', async () => {
    m.sendEmail.mockResolvedValue(false);
    expect((await resend(post({}), params('seat-1'))).status).toBe(502);
    expect(m.storeSeatCode).not.toHaveBeenCalled();
  });

  it.each([
    ['cooldown', 429],
    ['not_found', 404],
    ['no_team_plan', 402],
  ])('answers %s with %i', async (reason, status) => {
    m.prepareNewCode.mockResolvedValue({ ok: false, reason });
    expect((await resend(post({}), params('seat-1'))).status).toBe(status);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
});

describe('joining from Shield', () => {
  const body = { email: 'Prabhat@Example.com', code: CODE.toLowerCase(), name: 'Prabhat' };

  it('returns the member’s own key and the workspace', async () => {
    m.joinWithCode.mockResolvedValue({ ok: true, licenseKey: 'MG-X', workspace: 'Acme', name: 'Prabhat' });
    const res = await join(post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ licenseKey: 'MG-X', workspace: 'Acme', name: 'Prabhat' });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(m.joinWithCode).toHaveBeenCalledWith({ email: 'prabhat@example.com', code: CODE.toLowerCase(), name: 'Prabhat' });
  });

  it('gives the same answer for a wrong code, an unknown email and a bad request', async () => {
    m.joinWithCode.mockResolvedValue({ ok: false, reason: 'no_match' });
    const wrong = await join(post(body));
    const missing = await join(post({ email: 'nope' }));
    expect(wrong.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(await wrong.text()).toBe(await missing.text());
  });

  it('says when the team’s plan is not active', async () => {
    m.joinWithCode.mockResolvedValue({ ok: false, reason: 'plan_inactive' });
    expect((await join(post(body))).status).toBe(402);
  });

  it('is rate limited before any code is checked', async () => {
    m.join.mockResolvedValue({ success: false, retryAfter: 60 });
    expect((await join(post(body))).status).toBe(429);
    expect(m.joinWithCode).not.toHaveBeenCalled();
  });
});
