import { extractBearerToken, extractRawBearerToken, isCloudLicenseKey } from '@/lib/api-keys';
import { isPaidTier } from '@/lib/billing/paid-tier';
import { workspaceTier } from '@/lib/billing/workspace-tier';
import { allLicensedFeatures } from '@/lib/entitlements';
import { resolveOrgFromApiKey } from '@/lib/org-context';
import { NextResponse } from 'next/server';

function licensePayload(opts: {
  licensed: boolean;
  tenantSlug: string;
  orgId?: string;
  orgName?: string;
  status: string;
  tier?: string;
}) {
  return {
    licensed: opts.licensed,
    tenantSlug: opts.tenantSlug,
    orgId: opts.orgId,
    orgName: opts.orgName,
    status: opts.status,
    tier: opts.tier ?? 'free',
    paid: opts.tier !== undefined && isPaidTier(opts.tier),
    features: opts.licensed ? [...allLicensedFeatures()] : [],
    expiresAt: null as string | null,
    graceUntil: null as string | null,
    cloudBillingUrl: '',
  };
}

/** Validates cloud org API keys for self-hosted proxy ↔ control plane linking. */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const rawToken = extractRawBearerToken(authHeader);

  if (!rawToken) {
    return NextResponse.json({ error: 'Bearer token required' }, { status: 401 });
  }

  if (!isCloudLicenseKey(rawToken)) {
    return NextResponse.json(licensePayload({
      licensed: false,
      tenantSlug: 'default',
      status: 'invalid_key',
    }), { status: 401 });
  }

  const token = extractBearerToken(authHeader) ?? rawToken;
  const ctx = await resolveOrgFromApiKey(token);
  if (!ctx) {
    return NextResponse.json(licensePayload({
      licensed: false,
      tenantSlug: 'default',
      status: 'invalid_key',
    }), { status: 401 });
  }

  let tier: string;
  try {
    tier = await workspaceTier(ctx.org.id);
  } catch {
    // The proxy keeps its last answer through a short outage, rather than reading this as free.
    return NextResponse.json({ error: 'Plan unavailable' }, { status: 503 });
  }

  return NextResponse.json(
    licensePayload({
      licensed: true,
      tenantSlug: ctx.org.slug,
      orgId: ctx.org.id,
      orgName: ctx.org.name,
      status: 'active',
      tier,
    }),
  );
}
