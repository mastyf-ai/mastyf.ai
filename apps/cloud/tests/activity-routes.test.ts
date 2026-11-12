import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  ownerForRequest: vi.fn(),
  insertEvents: vi.fn(),
  pruneEvents: vi.fn(),
  listEvents: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('@/lib/activity/owner', () => ({ ownerForRequest: m.ownerForRequest }));
vi.mock('@/lib/activity/events-db', () => ({
  insertEvents: m.insertEvents,
  pruneEvents: m.pruneEvents,
  listEvents: m.listEvents,
}));
vi.mock('@/lib/rate-limit', () => ({ checkEventsRateLimit: m.limit }));

import { GET, POST } from '@/app/api/v1/events/route';

const FREE = { ownerId: 'org-1', tier: 'free', memberEmail: null };
const MEMBER = { ownerId: 'org-2', tier: 'paid', memberEmail: 'p@example.com' };
const post = (body: unknown) =>
  new Request('http://localhost/api/v1/events', {
    method: 'POST',
    headers: { authorization: 'Bearer mk_test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
const get = (query = '') => new Request(`http://localhost/api/v1/events${query}`, { headers: { authorization: 'Bearer MG-X' } }) as never;
const event = () => ({
  id: 'evt-0001',
  occurredAt: new Date(Date.now() - 60_000).toISOString(),
  server: 'shield-demo',
  tool: 'add_numbers',
  verdict: 'allow',
});

beforeEach(() => {
  vi.resetAllMocks();
  m.ownerForRequest.mockResolvedValue({ ok: true, role: 'workspace', scopes: ['activity:write'], owner: FREE });
  m.insertEvents.mockResolvedValue(1);
  m.pruneEvents.mockResolvedValue(undefined);
  m.listEvents.mockResolvedValue([]);
  m.limit.mockResolvedValue({ success: true });
});

describe('POST /api/v1/events', () => {
  it('stores a batch for the key owner and prunes what their plan no longer keeps', async () => {
    const res = await POST(post({ instanceId: 'inst-1', events: [event()] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 1, keptDays: 7 });
    expect(m.insertEvents).toHaveBeenCalledWith(FREE, 'inst-1', [expect.objectContaining({ server: 'shield-demo' })]);
    expect(m.pruneEvents).toHaveBeenCalledWith(FREE);
  });

  it('refuses a site key without the activity scope', async () => {
    m.ownerForRequest.mockResolvedValue({ ok: true, role: 'workspace', scopes: ['badge:read'], owner: FREE });
    const res = await POST(post({ events: [event()] }));
    expect(res.status).toBe(403);
    expect(m.insertEvents).not.toHaveBeenCalled();
  });

  it('refuses a request without a valid key', async () => {
    m.ownerForRequest.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' });
    const res = await POST(post({ events: [event()] }));
    expect(res.status).toBe(401);
    expect(m.insertEvents).not.toHaveBeenCalled();
  });

  it('refuses a bad batch without storing any of it', async () => {
    const res = await POST(post({ events: [event(), { ...event(), verdict: 'nope' }] }));
    expect(res.status).toBe(400);
    expect(m.insertEvents).not.toHaveBeenCalled();
  });

  it('slows a flood down', async () => {
    m.limit.mockResolvedValue({ success: false, retryAfter: 30 });
    const res = await POST(post({ events: [event()] }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });
});

describe('GET /api/v1/events', () => {
  it("shows a Team member only their own records", async () => {
    m.ownerForRequest.mockResolvedValue({ ok: true, role: 'member', owner: MEMBER });
    const res = await GET(get('?member=lead@example.com&days=30'));
    expect(res.status).toBe(200);
    expect(m.listEvents).toHaveBeenCalledWith('org-2', expect.objectContaining({ memberEmail: 'p@example.com', days: 30 }));
    expect((await res.json()).role).toBe('member');
  });

  it("lets a lead see the whole workspace or one person", async () => {
    m.ownerForRequest.mockResolvedValue({ ok: true, role: 'lead', owner: { ...MEMBER, memberEmail: null } });
    await GET(get());
    expect(m.listEvents).toHaveBeenLastCalledWith('org-2', expect.objectContaining({ memberEmail: null }));
    await GET(get('?member=P@Example.com'));
    expect(m.listEvents).toHaveBeenLastCalledWith('org-2', expect.objectContaining({ memberEmail: 'p@example.com' }));
  });

  it('never reaches past what the plan keeps', async () => {
    m.ownerForRequest.mockResolvedValue({ ok: true, role: 'buyer', owner: FREE });
    await GET(get('?days=400&limit=5000'));
    expect(m.listEvents).toHaveBeenCalledWith('org-1', expect.objectContaining({ days: 7, limit: 200 }));
  });

  it("won't let a site API key read records back", async () => {
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect(m.listEvents).not.toHaveBeenCalled();
  });
});
