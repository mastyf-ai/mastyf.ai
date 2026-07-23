import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveOrgAccess } from '@/lib/org-access';
import { sql } from 'drizzle-orm';

export async function GET(req: Request) {
  const access: any = await resolveOrgAccess(req);
  if (!access?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();

  const result: any = await db.execute(sql`
    SELECT t.*, count(tm.user_id)::int as member_count
    FROM teams t LEFT JOIN team_members tm ON t.id = tm.team_id
    WHERE t.org_id = ${access.orgId}
    GROUP BY t.id ORDER BY t.name
  `);

  const rows = result?.rows || [];
  const teams = rows.map((r: any) => ({
    id: r.id, name: r.name, slug: r.slug, description: r.description,
    memberCount: r.member_count, createdAt: r.created_at,
  }));

  return NextResponse.json({ teams });
}

export async function POST(req: Request) {
  const access: any = await resolveOrgAccess(req);
  if (!access?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();
  const body = await req.json();
  const { name, description, slug } = body;
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const teamSlug = slug || name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);
  await db.execute(sql`
    INSERT INTO teams (org_id, name, slug, description)
    VALUES (${access.orgId}, ${name}, ${teamSlug}, ${description || null})
  `);

  const result: any = await db.execute(sql`
    SELECT * FROM teams WHERE org_id = ${access.orgId} AND slug = ${teamSlug} LIMIT 1
  `);
  const r = (result?.rows || [])[0];

  return NextResponse.json({ team: { id: r?.id, name, slug: teamSlug, description, memberCount: 0 } }, { status: 201 });
}

export async function DELETE(req: Request) {
  const access: any = await resolveOrgAccess(req);
  if (!access?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get('id');
  if (!teamId) return NextResponse.json({ error: 'team id required' }, { status: 400 });

  await db.execute(sql`DELETE FROM team_members WHERE team_id = ${teamId}::uuid AND org_id = ${access.orgId}`);
  await db.execute(sql`DELETE FROM team_policies WHERE team_id = ${teamId}::uuid`);
  await db.execute(sql`DELETE FROM teams WHERE id = ${teamId}::uuid AND org_id = ${access.orgId}`);

  return NextResponse.json({ ok: true });
}
