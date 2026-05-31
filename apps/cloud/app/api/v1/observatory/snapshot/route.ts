import { NextResponse } from 'next/server';
import { observatorySnapshot, recordObservatoryMetric } from '../../../../../lib/cloud-observatory-store';

/** B2 — Ecosystem health observatory public snapshot. */
export async function GET() {
  return NextResponse.json(observatorySnapshot());
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const metricType = String(body.metricType ?? 'telemetry');
  const value = Number(body.value ?? 1);
  recordObservatoryMetric(metricType, value, body.dimension as Record<string, unknown> | undefined);
  return NextResponse.json({
    accepted: true,
    metricType,
    recordedAt: new Date().toISOString(),
  });
}
