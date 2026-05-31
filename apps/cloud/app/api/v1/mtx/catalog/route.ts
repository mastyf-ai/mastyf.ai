import { listMtxCatalog } from '@/lib/industry-standard';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit')) || 100;
  try {
    const entries = await listMtxCatalog(limit);
    return NextResponse.json({ entries, count: entries.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'catalog_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
