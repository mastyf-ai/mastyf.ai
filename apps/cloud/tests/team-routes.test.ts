import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  leadForLicenseKey: vi.fn(),
  listSeats: vi.fn(),
  seatOverview: vi.fn(),
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

vi.mock('@/lib/email', () => ({ sendEmail: m.sendEmail, emailConfigured: m.emailConfigured }));
vi.mock('@/lib/rate-limit', () => ({ checkTeamInviteRateLimit: m.invite, checkTeamJoinRateLimit: m.join }));
vi.mock('@/lib/billing/workspace-seats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/workspace-seats')>()),
  leadForLicenseKey: m.leadForLicenseKey,
  listSeats: m.listSeats,
  seatOverview: m.seatOverview,
  addSeat: m.addSeat,
  removeSeat: m.removeSeat,
  prepareNewCode: m.prepareNewCode,
  storeSeatCode: m.storeSeatCode,
  joinWithCode: m.joinWithCode,
}));

import { GET as list, POST as add } from '@/app/api/v1/team/members/route';
import { DELETE as remove, POST as resend } from '@/app/api/v1/team/members/[id]/route';
import { POST as join } from '@/app/api/v1/team/join/route';

const CODE = 'ABCD-2345';
const KEY = 'MG-AAAA-BBBB';
const headers = (key: string | null = KEY) => ({
  ...(key ? { authorization: `Bearer ${key}` } : {}),
  'x-mastyf-device': 'shield-abc',
});
const call = (body?: unknown, key: string | null = KEY) =>
  new Request('http://localhost/x', {
    method: 'POST',
    headers: headers(key),
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const LEAD = { orgId: 'org-1', orgName: 'Acme', userId: 'u1', email: 'ada@example.com', name: 'Ada' };

beforeEach(() => {
  vi.resetAllMocks();
  m.leadForLicenseKey.mockResolvedValue({ ok: true, lead: LEAD });
  m.emailConfigured.mockReturnValue(true);
  m.sendEmail.mockResolvedValue(true);
  m.invite.mockResolvedValue({ success: true });
  m.join.mockResolvedValue({ success: true });
  m.addSeat.mockResolvedValue({ ok: true, seatId: 'seat-1', code: CODE });
  m.seatOverview.mockResolvedValue({ allowed: true, maxPeople: 10 });
  m.listSeats.mockResolvedValue([{ id: 'seat-1', email: 'p@example.com', name: null, status: 'invited', joinedAt: null, codeExpiresAt: null }]);
});

describe('who can manage members', () => {
  const addP = (key?: string | null) => add(call({ email: 'p@example.com' }, key));

  it('needs a license key', async () => {
    expect((await addP(null)).status).toBe(401);
    expect(m.leadForLicenseKey).not.toHaveBeenCalled();
    expect((await addP('gcp_workspace_key')).status).toBe(401);
    expect(m.leadForLicenseKey).not.toHaveBeenCalled();
  });

  it('checks the key together with the device asking', async () => {
    await addP();
    expect(m.leadForLicenseKey).toHaveBeenCalledWith(KEY, 'shield-abc', undefined);
  });

  it('passes on the device secret when the app sends one', async () => {
    await add(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'x-mastyf-device': 'shield-abc', 'x-mastyf-device-secret': 's3cret' },
        body: JSON.stringify({ email: 'p@example.com' }),
      }) as never,
    );
    expect(m.leadForLicenseKey).toHaveBeenCalledWith(KEY, 'shield-abc', 's3cret');
  });

  it.each([
    ['bad_key', 401],
    ['member_key', 403],
    ['not_lead', 403],
    ['device', 403],
  ])('refuses %s with %i and adds nobody', async (reason, status) => {
    m.leadForLicenseKey.mockResolvedValue({ ok: false, reason });
    expect((await addP()).status).toBe(status);
    expect(m.addSeat).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
});

describe('listing members', () => {
  const get = () => list(new Request('http://localhost/x', { headers: headers() }) as never);

  it('gives a lead their people and the limit', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ allowed: true, workspace: 'Acme', leadEmail: 'ada@example.com', maxPeople: 10, seats: [{ id: 'seat-1' }] });
    expect(m.listSeats).toHaveBeenCalledWith('org-1');
  });

  it('tells a workspace that is not on Team only that', async () => {
    m.seatOverview.mockResolvedValue({ allowed: false, maxPeople: 1 });
    expect(await (await get()).json()).toEqual({ allowed: false });
    expect(m.listSeats).not.toHaveBeenCalled();
  });

  it.each(['member_key', 'not_lead', 'device'])('shows %s nothing about the team', async (reason) => {
    m.leadForLicenseKey.mockResolvedValue({ ok: false, reason });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowed: false });
  });

  it('is 401 for a key that is not valid', async () => {
    m.leadForLicenseKey.mockResolvedValue({ ok: false, reason: 'bad_key' });
    expect((await get()).status).toBe(401);
  });
});

describe('adding a member', () => {
  const addP = (email = 'Prabhat@Example.com') => add(call({ email }));

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

  it('adds to the lead’s own workspace, and emails the code to that person', async () => {
    const res = await addP();
    expect(res.status).toBe(200);
    expect(m.addSeat).toHaveBeenCalledWith({ orgId: 'org-1', email: 'prabhat@example.com', invitedBy: 'u1', leadEmail: 'ada@example.com' });
    const mail = m.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('prabhat@example.com');
    expect(mail.text).toContain(CODE);
    expect(mail.subject).toContain('Ada');
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
  it('needs a lead’s key', async () => {
    m.leadForLicenseKey.mockResolvedValue({ ok: false, reason: 'member_key' });
    expect((await remove(call(), params('seat-1'))).status).toBe(403);
    expect(m.removeSeat).not.toHaveBeenCalled();
  });

  it('only reaches into the lead’s own workspace', async () => {
    m.removeSeat.mockResolvedValue(true);
    expect((await remove(call(), params('seat-1'))).status).toBe(200);
    expect(m.removeSeat).toHaveBeenCalledWith('org-1', 'seat-1');
  });

  it('is 404 for a seat that is not in this workspace', async () => {
    m.removeSeat.mockResolvedValue(false);
    expect((await remove(call(), params('other'))).status).toBe(404);
  });
});

describe('sending a new code', () => {
  beforeEach(() => {
    m.prepareNewCode.mockResolvedValue({ ok: true, email: 'p@example.com', code: CODE });
  });

  it('needs a lead’s key', async () => {
    m.leadForLicenseKey.mockResolvedValue({ ok: false, reason: 'member_key' });
    expect((await resend(call(), params('seat-1'))).status).toBe(403);
    expect(m.prepareNewCode).not.toHaveBeenCalled();
  });

  it('emails the code and never returns it', async () => {
    const res = await resend(call(), params('seat-1'));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain(CODE);
    expect(m.prepareNewCode).toHaveBeenCalledWith('org-1', 'seat-1');
    expect(m.storeSeatCode).toHaveBeenCalledWith('seat-1', 'p@example.com', CODE);
  });

  it('keeps the old code working if the email fails', async () => {
    m.sendEmail.mockResolvedValue(false);
    expect((await resend(call(), params('seat-1'))).status).toBe(502);
    expect(m.storeSeatCode).not.toHaveBeenCalled();
  });

  it.each([
    ['cooldown', 429],
    ['not_found', 404],
    ['no_team_plan', 402],
  ])('answers %s with %i', async (reason, status) => {
    m.prepareNewCode.mockResolvedValue({ ok: false, reason });
    expect((await resend(call(), params('seat-1'))).status).toBe(status);
    expect(m.sendEmail).not.toHaveBeenCalled();
  });
});

describe('joining from Shield', () => {
  const body = { email: 'Prabhat@Example.com', code: CODE.toLowerCase(), name: 'Prabhat' };

  it('returns the member’s own key and the workspace', async () => {
    m.joinWithCode.mockResolvedValue({ ok: true, licenseKey: 'MG-X', workspace: 'Acme', name: 'Prabhat' });
    const res = await join(call(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ licenseKey: 'MG-X', workspace: 'Acme', name: 'Prabhat' });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(m.joinWithCode).toHaveBeenCalledWith({ email: 'prabhat@example.com', code: CODE.toLowerCase(), name: 'Prabhat' });
  });

  it('gives the same answer for a wrong code, an unknown email and a bad request', async () => {
    m.joinWithCode.mockResolvedValue({ ok: false, reason: 'no_match' });
    const wrong = await join(call(body));
    const missing = await join(call({ email: 'nope' }));
    expect(wrong.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(await wrong.text()).toBe(await missing.text());
  });

  it('says when the team’s plan is not active', async () => {
    m.joinWithCode.mockResolvedValue({ ok: false, reason: 'plan_inactive' });
    expect((await join(call(body))).status).toBe(402);
  });

  it('is rate limited before any code is checked', async () => {
    m.join.mockResolvedValue({ success: false, retryAfter: 60 });
    expect((await join(call(body))).status).toBe(429);
    expect(m.joinWithCode).not.toHaveBeenCalled();
  });
});
