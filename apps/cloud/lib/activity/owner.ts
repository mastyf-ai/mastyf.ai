import { sql } from 'drizzle-orm';
import { extractBearerToken, extractRawBearerToken } from '@/lib/api-keys';
import { getDb } from '@/lib/db';
import { rowsOf } from '@/lib/dashboard-shared';
import { resolveOrgFromApiKey } from '@/lib/org-context';
import { isPaidTier } from '@/lib/billing/paid-tier';
import { workspaceTier } from '@/lib/billing/workspace-tier';
import { deviceDecision, entitlementActive, findIssuedEntitlement, SEAT_SOURCE } from '@/lib/billing/license-keys';
import { leadForLicenseKey } from '@/lib/billing/workspace-seats';
import type { EventOwner } from './events-db';

/**
 * Who sent a request: a site API key (the `mastyf` command) or a Shield license key. A Team member's
 * key records into the lead's workspace under the member's email; a buyer with no site account gets a
 * workspace of their own keyed by the purchase.
 */
export type OwnerRole = 'workspace' | 'lead' | 'member' | 'buyer';
export type OwnerLookup =
  | { ok: true; owner: EventOwner; role: OwnerRole }
  | { ok: false; status: 401 | 403; error: string };

const UNAUTHORIZED: OwnerLookup = { ok: false, status: 401, error: 'Unauthorized' };

export async function ownerForRequest(request: Request): Promise<OwnerLookup> {
  const raw = extractRawBearerToken(request.headers.get('authorization')) ?? '';
  if (raw.startsWith('MG-')) return ownerForLicenseKey(raw, request.headers.get('x-mastyf-device')?.trim() ?? '');

  const bearer = extractBearerToken(request.headers.get('authorization'));
  if (!bearer) return UNAUTHORIZED;
  const ctx = await resolveOrgFromApiKey(bearer);
  if (!ctx) return UNAUTHORIZED;
  const tier = isPaidTier(await workspaceTier(ctx.org.id)) ? 'paid' : 'free';
  return { ok: true, role: 'workspace', owner: { ownerId: ctx.org.id, tier, memberEmail: null } };
}

async function ownerForLicenseKey(key: string, device: string): Promise<OwnerLookup> {
  const entitlement = await findIssuedEntitlement(key);
  if (!entitlement || !entitlementActive(entitlement)) return UNAUTHORIZED;
  if (deviceDecision(entitlement, device) !== 'allow') {
    return { ok: false, status: 403, error: 'This license key is active on another device.' };
  }

  if (entitlement.source === SEAT_SOURCE) {
    const [seat] = rowsOf<{ org_id: string; email: string }>(
      await getDb().execute(sql`
        SELECT org_id, email FROM workspace_seats
        WHERE entitlement_id = ${entitlement.id} AND status = 'joined'
        LIMIT 1
      `),
    );
    if (!seat) return { ok: false, status: 403, error: 'This key is no longer part of a workspace.' };
    return { ok: true, role: 'member', owner: { ownerId: seat.org_id, tier: 'paid', memberEmail: seat.email } };
  }

  const lead = await leadForLicenseKey(key, device);
  if (lead.ok) return { ok: true, role: 'lead', owner: { ownerId: lead.lead.orgId, tier: 'paid', memberEmail: null } };
  return {
    ok: true,
    role: 'buyer',
    owner: { ownerId: `customer:${entitlement.customerId}`, tier: 'paid', memberEmail: null },
  };
}
