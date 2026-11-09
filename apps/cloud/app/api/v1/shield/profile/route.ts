import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { extractRawBearerToken } from '@/lib/api-keys';
import { entitlementActive, findIssuedEntitlement } from '@/lib/billing/license-keys';
import { cloudDbAvailable, getDb } from '@/lib/db';
import { commercialCustomers, users } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const preferredRegion = 'hnd1';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Who a Shield licence belongs to, so the desktop app can show its owner. The key is the only credential. */
export async function GET(request: Request) {
  const key = extractRawBearerToken(request.headers.get('authorization'));
  if (!key) return json({ error: 'Unauthorized' }, 401);
  if (!cloudDbAvailable()) return json({ error: 'Unavailable' }, 503);

  const entitlement = await findIssuedEntitlement(key);
  if (!entitlement) return json({ error: 'Unauthorized' }, 401);

  const db = getDb();
  const customer = await db.query.commercialCustomers.findFirst({
    where: eq(commercialCustomers.id, entitlement.customerId),
  });
  if (!customer) return json({ error: 'Unauthorized' }, 401);

  // A buyer may have paid without ever creating a website account, so this can be empty.
  const user = await db.query.users.findFirst({ where: eq(users.email, customer.email) });

  return json({
    name: user?.name ?? null,
    email: customer.email,
    image: user?.image ?? null,
    active: entitlementActive(entitlement),
    expiresAt: entitlement.expiresAt?.toISOString() ?? null,
  });
}
