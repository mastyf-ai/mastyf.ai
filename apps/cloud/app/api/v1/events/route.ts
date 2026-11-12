import { NextResponse } from 'next/server';
import { parseEventBatch, retentionDays } from '@/lib/activity/event-batch';
import { insertEvents, listEvents, pruneEvents } from '@/lib/activity/events-db';
import { ownerForRequest } from '@/lib/activity/owner';
import { normalizeEmail } from '@/lib/billing/workspace-seats';
import { checkEventsRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_LIST = 200;

/**
 * POST /api/v1/events — batches of activity records from the `mastyf` command or the Shield app.
 * Snippets arrive already redacted; the batch parser scrubs again before anything is stored.
 */
export async function POST(request: Request) {
  const found = await ownerForRequest(request);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status, headers: NO_STORE });
  if (found.role === 'workspace' && !found.scopes?.includes('activity:write')) {
    return NextResponse.json(
      { error: 'This key cannot send activity. Create a new key under Settings.' },
      { status: 403, headers: NO_STORE },
    );
  }

  const limited = await checkEventsRateLimit(found.owner.ownerId);
  if (!limited.success) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limited.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE });
  }
  const batch = parseEventBatch(body);
  if (!batch.ok) return NextResponse.json({ error: batch.error }, { status: 400, headers: NO_STORE });

  try {
    const stored = await insertEvents(found.owner, batch.instanceId, batch.events);
    await pruneEvents(found.owner);
    return NextResponse.json({ stored, keptDays: retentionDays(found.owner.tier) }, { headers: NO_STORE });
  } catch {
    console.error('[events] could not store a batch');
    return NextResponse.json({ error: 'Could not store the records. Try again.' }, { status: 503, headers: NO_STORE });
  }
}

/**
 * GET /api/v1/events — what Shield shows. A lead sees the whole workspace (or one person with
 * `member`); a Team member sees only their own records.
 */
export async function GET(request: Request) {
  const found = await ownerForRequest(request);
  if (!found.ok) return NextResponse.json({ error: found.error }, { status: found.status, headers: NO_STORE });
  // A site API key can send records but not read them back: they are read on mastyf.ai, signed in,
  // or in Shield with its license key. A leaked proxy key then exposes nothing.
  if (found.role === 'workspace') {
    return NextResponse.json({ error: 'Read activity on mastyf.ai or in Shield.' }, { status: 403, headers: NO_STORE });
  }

  const url = new URL(request.url);
  const kept = retentionDays(found.owner.tier);
  const days = Math.min(kept, Math.max(1, Number.parseInt(url.searchParams.get('days') ?? '', 10) || kept));
  const limit = Math.min(MAX_LIST, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '', 10) || 100));
  const before = url.searchParams.get('before');
  const asked = url.searchParams.get('member');
  const memberEmail =
    found.role === 'member' ? found.owner.memberEmail : asked ? normalizeEmail(asked) : null;

  try {
    const events = await listEvents(found.owner.ownerId, {
      memberEmail,
      days,
      limit,
      before: before && Number.isFinite(Date.parse(before)) ? new Date(before).toISOString() : null,
    });
    return NextResponse.json({ role: found.role, keptDays: kept, events }, { headers: NO_STORE });
  } catch {
    console.error('[events] could not list records');
    return NextResponse.json({ error: 'Could not read the records. Try again.' }, { status: 503, headers: NO_STORE });
  }
}
