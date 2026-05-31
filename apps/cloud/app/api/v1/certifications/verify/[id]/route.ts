import { verifyPublicCertification } from '@/lib/industry-standard';
import { NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const verification = await verifyPublicCertification(id.trim());
    if (!verification.found) {
      return NextResponse.json({ error: 'certification_not_found' }, { status: 404 });
    }
    return NextResponse.json({
      id: id.trim(),
      valid: verification.valid,
      expired: verification.expired,
      attestationFormatOk: verification.attestationFormatOk,
      certification: verification.certification,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'verify_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
