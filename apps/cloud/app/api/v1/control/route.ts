import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveOrgAccess } from '@/lib/org-access';
import { sql } from 'drizzle-orm';

async function getAccess(req: Request): Promise<any> {
  try { return await resolveOrgAccess(req); } catch { return null; }
}

function json(d: unknown, s = 200) { return NextResponse.json(d, { status: s }); }

export async function GET(req: Request) {
  const access = await getAccess(req);
  if (!access?.orgId) return json({ error: 'Unauthorized' }, 401);
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'policy') {
    const result: any = await db.execute(sql`
      SELECT version, yaml_content, published_at
      FROM policy_versions WHERE org_id = ${access.orgId}
      ORDER BY version DESC LIMIT 1
    `);
    const rows = result?.rows || result || [];
    const row = (Array.isArray(rows) ? rows[0] : rows) || {};
    return json({ version: row.version || 0, policy: row.yaml_content || '', publishedAt: row.published_at || null });
  }

  if (action === 'license') {
    const licResult: any = await db.execute(sql`
      SELECT tier, features, max_instances FROM licenses
      WHERE org_id = ${access.orgId} AND revoked_at IS NULL
      ORDER BY activated_at DESC LIMIT 1
    `);
    const licRows = licResult?.rows || licResult || [];
    const lic = (Array.isArray(licRows) ? licRows[0] : licRows) || {};
    const tier = lic.tier || 'free';
    return json({ tier, features: lic.features || [], maxInstances: lic.max_instances || 1 });
  }

  if (action === 'fleet-summary') {
    const result: any = await db.execute(sql`
      SELECT coalesce(sum(total_requests),0)::int as total,
             coalesce(sum(blocked_requests),0)::int as blocked,
             coalesce(sum(allowed_requests),0)::int as "allowed"
      FROM fleet_audit_aggregates WHERE org_id = ${access.orgId}
    `);
    const rows = result?.rows || result || [];
    const row = (Array.isArray(rows) ? rows[0] : rows) || {};
    return json({ totalRequests: row.total || 0, blockedRequests: row.blocked || 0, allowedRequests: row.allowed || 0 });
  }

  if (action === 'license') {
    // Return license tier info for the proxy
    const licResult: any = await db.execute(sql`
      SELECT tier, features, max_instances FROM licenses
      WHERE org_id = ${access.orgId} AND revoked_at IS NULL
      ORDER BY activated_at DESC LIMIT 1
    `);
    const licRows = licResult?.rows || licResult || [];
    const lic = (Array.isArray(licRows) ? licRows[0] : licRows) || {};
    const tier = lic.tier || 'free';
    return json({ tier, features: lic.features || [], maxInstances: lic.max_instances || 1 });
  }

  return json({ error: 'Unknown action' }, 400);
}

export async function POST(req: Request) {
  const access = await getAccess(req);
  if (!access?.orgId) return json({ error: 'Unauthorized' }, 401);
  const db = getDb();
  const body = await req.json();
  const { action, ...p } = body;

  if (action === 'heartbeat') {
    if (!p.instanceId) return json({ error: 'instanceId required' }, 400);
    const existing: any = await db.execute(sql`
      SELECT id FROM mastyf_ai_fleet_instances
      WHERE org_id = ${access.orgId} AND instance_id = ${p.instanceId} LIMIT 1
    `);
    const has = ((existing?.rows || existing || [])[0]);
    if (has) {
      await db.execute(sql`
        UPDATE mastyf_ai_fleet_instances SET instance_name=${p.instanceName||null},
          region=${p.region||null}, version=${p.version||null}, hostname=${p.hostname||null},
          status=${p.status||'online'}, last_heartbeat=NOW()
        WHERE org_id=${access.orgId} AND instance_id=${p.instanceId}
      `);
    } else {
      await db.execute(sql`
        INSERT INTO mastyf_ai_fleet_instances (org_id,instance_id,instance_name,region,version,hostname,status)
        VALUES (${access.orgId},${p.instanceId},${p.instanceName||null},${p.region||null},${p.version||null},${p.hostname||null},${p.status||'online'})
      `);
    }
    return json({ ok: true });
  }

  if (action === 'audit-push') {
    if (!p.instanceId || !p.aggregates) return json({ error: 'instanceId and aggregates required' }, 400);
    const a = p.aggregates as any;
    await db.execute(sql`
      INSERT INTO fleet_audit_aggregates (org_id,instance_id,period_start,period_end,total_requests,blocked_requests,allowed_requests,flagged_requests,top_blocked_tools,top_blocked_rules,avg_latency_ms)
      VALUES (${access.orgId},${p.instanceId},${p.periodStart}::timestamptz,${p.periodEnd}::timestamptz,
        ${a.totalRequests||0},${a.blockedRequests||0},${a.allowedRequests||0},
        ${a.flaggedRequests||0},${JSON.stringify(a.topBlockedTools||[])},
        ${JSON.stringify(a.topBlockedRules||[])},${a.avgLatencyMs||0})
    `);
    return json({ ok: true });
  }

  if (action === 'publish-policy') {
    if (!p.yaml) return json({ error: 'yaml content required' }, 400);
    const vResult: any = await db.execute(sql`
      SELECT coalesce(max(version),0)+1 as next_version
      FROM policy_versions WHERE org_id=${access.orgId}
    `);
    const vRows = vResult?.rows || vResult || [];
    const nextVer = (Array.isArray(vRows) ? vRows[0] : vRows)?.next_version || 1;
    await db.execute(sql`
      INSERT INTO policy_versions (org_id,version,yaml_content,published_by)
      VALUES (${access.orgId},${nextVer},${p.yaml},${access.userId||null})
    `);
    return json({ version: nextVer, publishedAt: new Date().toISOString() });
  }

  return json({ error: 'Unknown action' }, 400);
}
