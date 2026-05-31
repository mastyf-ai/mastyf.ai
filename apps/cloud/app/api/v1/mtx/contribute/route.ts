import { contributeMtxRecord } from '@/lib/industry-standard';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const record =
    body && typeof body === 'object' && 'mtxRecord' in (body as object)
      ? (body as { mtxRecord: Record<string, unknown> }).mtxRecord
      : (body as Record<string, unknown>);

  try {
    const result = await contributeMtxRecord(record);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'contribute_failed';
    const status = message === 'invalid_mtx_record' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
