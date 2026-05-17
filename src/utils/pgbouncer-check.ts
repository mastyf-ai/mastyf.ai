/**
 * Heuristics for PgBouncer vs direct Postgres URLs at startup.
 * See docs/SCALE_AND_RESILIENCE.md (100-replica chaos test).
 */

import { Logger } from './logger.js';

export function isPgbouncerConnectionUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl?.trim()) return false;
  const lower = databaseUrl.toLowerCase();
  if (/pgbouncer|pooler/.test(lower)) return true;
  if (/:(6432)(\/|\?|$)/.test(lower)) return true;
  try {
    const normalized = databaseUrl.replace(/^postgres(ql)?:\/\//i, 'http://');
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase();
    const port = u.port || '5432';
    if (host.includes('pgbouncer') || host.endsWith('-pooler')) return true;
    if (port === '6432') return true;
  } catch {
    // regex fallbacks above
  }
  return false;
}

export function isDirectPostgresUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl?.trim()) return false;
  if (isPgbouncerConnectionUrl(databaseUrl)) return false;
  try {
    const normalized = databaseUrl.replace(/^postgres(ql)?:\/\//i, 'http://');
    const u = new URL(normalized);
    return (u.port || '5432') === '5432';
  } catch {
    return /:5432(\/|\?|$)/.test(databaseUrl);
  }
}

export interface PgBouncerStartupContext {
  dbType: string;
  databaseUrl?: string;
  replicaCount: number;
  inK8s: boolean;
  redisConfigured: boolean;
  strictMode: boolean;
  requirePgBouncer: boolean;
}

export type PgBouncerCheckResult =
  | { action: 'none' }
  | { action: 'warn'; message: string }
  | { action: 'error'; message: string };

export function evaluatePgBouncerStartup(ctx: PgBouncerStartupContext): PgBouncerCheckResult {
  if (ctx.dbType !== 'postgres') return { action: 'none' };
  if (!ctx.databaseUrl?.trim()) return { action: 'none' };

  const haHint =
    ctx.replicaCount > 1 || ctx.inK8s || (ctx.redisConfigured && ctx.replicaCount >= 1);
  const viaPooler = isPgbouncerConnectionUrl(ctx.databaseUrl);
  const direct = isDirectPostgresUrl(ctx.databaseUrl);

  if (ctx.requirePgBouncer && !viaPooler) {
    return {
      action: 'error',
      message:
        `[PgBouncer] GUARDIAN_REQUIRE_PGBOUNCER=true but DATABASE_URL does not target a pooler ` +
          `(expected hostname containing "pgbouncer" or port 6432). See docs/SCALE_AND_RESILIENCE.md.`,
    };
  }

  if (direct && haHint) {
    const msg =
      `[PgBouncer] DATABASE_URL points at direct Postgres (:5432). ` +
      `PgBouncer is required for production multi-replica K8s (>50 replicas or shared Postgres audit). ` +
      `Chaos test: max_connections=100 exhausted at 87 replicas without a pooler. ` +
      `Route DATABASE_URL through PgBouncer (transaction mode). See docs/SCALE_AND_RESILIENCE.md.`;
    if (ctx.strictMode && ctx.replicaCount > 50) {
      return { action: 'error', message: msg };
    }
    return { action: 'warn', message: msg };
  }

  return { action: 'none' };
}

export function checkPgBouncerAtStartup(): void {
  const ctx: PgBouncerStartupContext = {
    dbType: (process.env['DB_TYPE'] || 'sqlite').toLowerCase(),
    databaseUrl: process.env['DATABASE_URL'],
    replicaCount: parseInt(process.env['REPLICA_COUNT'] ?? '1', 10),
    inK8s: !!process.env['KUBERNETES_SERVICE_HOST'],
    redisConfigured: (() => {
      try {
        // lazy import avoided — duplicate env check
        return !!(
          process.env['REDIS_URL'] ||
          process.env['REDIS_SENTINELS'] ||
          process.env['REDIS_CLUSTER_NODES']
        );
      } catch {
        return false;
      }
    })(),
    strictMode: process.env['GUARDIAN_STRICT_MODE'] === 'true',
    requirePgBouncer: process.env['GUARDIAN_REQUIRE_PGBOUNCER'] === 'true',
  };
  const result = evaluatePgBouncerStartup(ctx);
  if (result.action === 'warn') {
    Logger.warn(result.message);
  } else if (result.action === 'error') {
    Logger.error(result.message);
    process.exit(1);
  }
}
