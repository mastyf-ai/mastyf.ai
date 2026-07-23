import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function GET(req: Request) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'entries';

  if (action === 'entries') {
    const category = searchParams.get('category');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const since = searchParams.get('since');

    let query = sql`SELECT * FROM public_threat_feed_entries`;
    const conditions: any[] = [];
    if (category) conditions.push(sql`category = ${category}`);
    if (since) conditions.push(sql`last_seen > ${since}::timestamptz`);

    if (conditions.length > 0) {
      query = sql`${query} WHERE `;
      conditions.forEach((c, i) => {
        query = sql`${query} ${c}`;
        if (i < conditions.length - 1) query = sql`${query} AND `;
      });
    }
    query = sql`${query} ORDER BY last_seen DESC LIMIT ${limit}`;

    const result: any = await db.execute(query);
    const rows = result?.rows || [];
    return NextResponse.json({
      entries: rows.map((r: any) => ({
        signatureHash: r.signature_hash,
        toolPattern: r.tool_pattern,
        argPatternHash: r.arg_pattern_hash,
        category: r.category,
        blockReason: r.block_reason,
        reportCount: r.report_count,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
      })),
      total: rows.length,
      version: 1,
    });
  }

  if (action === 'stats') {
    const result: any = await db.execute(sql`
      SELECT category, count(*)::int as count, max(last_seen) as latest
      FROM public_threat_feed_entries
      GROUP BY category ORDER BY count DESC
    `);
    return NextResponse.json({ categories: result?.rows || [] });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function POST(req: Request) {
  const db = getDb();
  const body = await req.json();
  const { entries } = body;

  if (!Array.isArray(entries) || entries.length === 0) {
    return NextResponse.json({ error: 'entries array required' }, { status: 400 });
  }

  let added = 0;
  for (const entry of entries) {
    if (!entry.signatureHash || !entry.toolPattern || !entry.category) continue;
    try {
      await db.execute(sql`
        INSERT INTO public_threat_feed_entries (signature_hash, tool_pattern, arg_pattern_hash, category, block_reason, report_count)
        VALUES (${entry.signatureHash}, ${entry.toolPattern}, ${entry.argPatternHash || ''}, ${entry.category}, ${entry.blockReason || ''}, 1)
        ON CONFLICT (signature_hash) DO UPDATE SET
          report_count = public_threat_feed_entries.report_count + 1,
          last_seen = NOW()
      `);
      added++;
    } catch {}
  }

  return NextResponse.json({ added, total: entries.length });
}
