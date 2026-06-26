import { cloudDbAvailable } from '@/lib/db';

export function isDatabaseUnavailableError(err: unknown): boolean {
  if (!cloudDbAvailable()) return true;
  if (!(err instanceof Error)) return false;
  return err.message.includes('DATABASE_URL is required');
}

export function databaseUnavailableResponse(): Response {
  return Response.json({ error: 'database_unavailable' }, { status: 503 });
}

export function certificationsUnavailablePayload() {
  return {
    certifications: [] as unknown[],
    count: 0,
    unavailable: true,
    reason: 'database_unconfigured' as const,
  };
}
