import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveOrgAccess } from '@/lib/org-access';
import { sql } from 'drizzle-orm';
import { LICENSE_TIERS as TIERS } from '@/lib/license-tiers';

export async function GET(req: Request) {
  const access: any = await resolveOrgAccess(req);
  if (!access?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const result: any = await db.execute(sql`
    SELECT * FROM licenses WHERE org_id = ${access.orgId}::text AND revoked_at IS NULL
    ORDER BY activated_at DESC LIMIT 1
  `);
  const rows = (result?.rows && Array.isArray(result.rows) ? result.rows : Array.isArray(result) ? result : [result]) || [];
  const lic = rows[0] || null;
  const tier = (lic?.tier as string) || 'free';
  const tierConfig = TIERS[tier] || TIERS.free;

  return NextResponse.json({
    tier,
    maxInstances: tierConfig.maxInstances,
    maxTeams: tierConfig.maxTeams,
    maxUsers: tierConfig.maxUsers,
    features: tierConfig.features,
    activatedAt: lic?.activated_at || null,
    expiresAt: lic?.expires_at || null,
  });
}
