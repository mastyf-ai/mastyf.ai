import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { users, organizations, organizationMembers, apiKeys, policies } from '@/lib/db/schema';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { sql } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const db = getDb();
    const userCount = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    if (userCount[0]?.count > 0) return NextResponse.json({ error: 'Setup already completed' }, { status: 409 });

    const body = await req.json();
    const { email, name, password } = body;
    if (!email || !password) return NextResponse.json({ error: 'Email and password required' }, { status: 400 });

    const userId = randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(password, 10);
    await db.insert(users).values({ id: userId, email, name: name || email.split('@')[0], emailVerified: new Date() } as any);
    await db.update(users).set({ passwordHash: passwordHash } as any).where({ id: userId } as any);

    const orgId = randomBytes(16).toString('hex');
    await db.insert(organizations).values({ id: orgId, slug: 'default', name: `${name || 'Admin'}'s Org`, owner_user_id: userId } as any);
    await db.insert(organizationMembers).values({ org_id: orgId, user_id: userId, role: 'owner' } as any);

    const apiKey = `gcp_${randomBytes(32).toString('base64url')}`;
    const keyHash = await bcrypt.hash(apiKey, 10);
    await db.insert(apiKeys).values({ id: randomBytes(16).toString('hex'), org_id: orgId, key_hash: keyHash, prefix: 'gcp_', name: 'Default', scopes: '["badge:read","policy:read","policy:write","fleet:write","deep-scan:run","keys:manage"]' } as any);

    await db.insert(policies).values({ id: randomBytes(16).toString('hex'), org_id: orgId, yaml_content: '', version: 1 } as any);

    return NextResponse.json({ ok: true, apiKey, orgId, userId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  const db = getDb();
  const userCount = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return NextResponse.json({ setupRequired: userCount[0]?.count === 0 });
}
