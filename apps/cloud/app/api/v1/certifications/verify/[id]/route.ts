import { verifyPublicCertification } from '@/lib/industry-standard';
import {
  databaseUnavailableResponse,
  isDatabaseUnavailableError,
} from '@/lib/cloud-db-guard';
import { cloudDbAvailable } from '@/lib/db';
import { NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  if (!cloudDbAvailable()) {
    return databaseUnavailableResponse();
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
    if (isDatabaseUnavailableError(err)) {
      return databaseUnavailableResponse();
    }
    const message = err instanceof Error ? err.message : 'verify_failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
