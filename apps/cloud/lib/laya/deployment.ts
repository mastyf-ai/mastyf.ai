import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { layaDeployments } from '@/lib/db/schema';

export type LayaTarget =
  | { kind: 'remote'; endpoint: string; secret: string }
  | { kind: 'self_hosted' }
  | { kind: 'unavailable' };

// A row may only point at variables reserved for Laya secrets, never at AUTH_SECRET and the like.
const SECRET_REF = /^LAYA_SECRET_[A-Z0-9_]+$/;

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** A plain-http laya-serve on this machine, for local development only. */
function isLocalDevHttp(url: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

function sharedTarget(): LayaTarget {
  const endpoint = process.env.LAYA_SHARED_URL?.trim();
  const secret = process.env.LAYA_SHARED_SECRET;
  if (!endpoint || !secret) return { kind: 'unavailable' };
  if (!isHttps(endpoint) && !isLocalDevHttp(endpoint)) return { kind: 'unavailable' };
  return { kind: 'remote', endpoint, secret };
}

/** Where this workspace's Laya calls go. No row, or a shared row, means the shared server. */
export async function resolveLayaTarget(orgId: string): Promise<LayaTarget> {
  const row = await getDb().query.layaDeployments.findFirst({
    where: eq(layaDeployments.orgId, orgId),
  });
  if (!row || row.mode === 'shared') return sharedTarget();
  if (row.mode === 'self_hosted') return { kind: 'self_hosted' };
  if (row.mode !== 'dedicated' || row.status !== 'active') return { kind: 'unavailable' };

  const { endpoint, secretRef } = row;
  if (!endpoint || !isHttps(endpoint)) return { kind: 'unavailable' };
  if (!secretRef || !SECRET_REF.test(secretRef)) return { kind: 'unavailable' };
  const secret = process.env[secretRef];
  if (!secret) return { kind: 'unavailable' };
  return { kind: 'remote', endpoint, secret };
}
