/**
 * PostgreSQL persistence for semantic audit outcomes (enterprise / DATABASE_URL).
 * JSONL in semantic-audit-store.ts is used when PostgreSQL is not configured.
 */
import type { StoredSemanticAudit } from './semantic-audit-store.js';
import { resolveTenantId } from '../tenant/resolve-tenant.js';
import { Logger } from '../utils/logger.js';

export function isSemanticAuditPostgresEnabled(): boolean {
  const dbType = (process.env.DB_TYPE || 'sqlite').toLowerCase();
  return dbType === 'postgres' && Boolean(process.env.DATABASE_URL?.trim());
}

let poolPromise: Promise<import('../database/pg-loader.js').PgPoolType | null> | null = null;

async function getPool(): Promise<import('../database/pg-loader.js').PgPoolType | null> {
  if (!isSemanticAuditPostgresEnabled()) return null;
  if (!poolPromise) {
    poolPromise = (async () => {
      try {
        const { loadPg } = await import('../database/pg-loader.js');
        const { Pool } = await loadPg();
        const poolMax = parseInt(process.env.MASTYF_AI_PG_POOL_MAX ?? '5', 10);
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 5,
          idleTimeoutMillis: 30000,
        });
        const { runMigrations } = await import('../database/migration-runner.js');
        await runMigrations(pool);
        return pool;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.debug(`[semantic-audit-pg] Pool init failed: ${msg}`);
        return null;
      }
    })();
  }
  return poolPromise;
}

function rowToRecord(row: Record<string, unknown>): StoredSemanticAudit {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id || 'default'),
    requestId: row.request_id as string | number,
    serverName: String(row.server_name),
    toolName: String(row.tool_name),
    syncDecision: row.sync_decision as StoredSemanticAudit['syncDecision'],
    semanticAudit: row.semantic_audit as StoredSemanticAudit['semanticAudit'],
    model: row.model ? String(row.model) : undefined,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
    timestamp: new Date(String(row.recorded_at)).toISOString(),
    labeled: Boolean(row.labeled),
    label: row.label as StoredSemanticAudit['label'],
    labelUserId: row.label_user_id ? String(row.label_user_id) : undefined,
    labelAt: row.label_at ? new Date(String(row.label_at)).toISOString() : undefined,
    argumentsSnapshot: row.arguments_snapshot as Record<string, unknown> | undefined,
  };
}

export async function pgAppendSemanticAuditRecord(
  record: Omit<StoredSemanticAudit, 'id' | 'tenantId'> & { id?: string },
): Promise<string | null> {
  const pool = await getPool();
  if (!pool) return null;
  const tenantId = resolveTenantId();
  const id = record.id || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  try {
    await pool.query(
      `INSERT INTO semantic_audit_outcomes (
        id, tenant_id, request_id, server_name, tool_name,
        sync_decision, semantic_audit, model, duration_ms, recorded_at, arguments_snapshot
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        tenantId,
        String(record.requestId ?? ''),
        record.serverName,
        record.toolName,
        JSON.stringify(record.syncDecision),
        JSON.stringify(record.semanticAudit),
        record.model ?? null,
        record.durationMs ?? null,
        record.timestamp || new Date().toISOString(),
        record.argumentsSnapshot ? JSON.stringify(record.argumentsSnapshot) : null,
      ],
    );
    return id;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.debug(`[semantic-audit-pg] append failed: ${msg}`);
    return null;
  }
}

export async function pgLoadSemanticAuditRecords(opts?: {
  tenantId?: string;
  sinceMs?: number;
  limit?: number;
}): Promise<StoredSemanticAudit[]> {
  const pool = await getPool();
  if (!pool) return [];
  const tenantId = opts?.tenantId || resolveTenantId();
  const since = opts?.sinceMs ?? 7 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - since).toISOString();
  const limit = opts?.limit ?? 2000;
  try {
    const result = await pool.query(
      `SELECT * FROM semantic_audit_outcomes
       WHERE tenant_id = $1 AND recorded_at >= $2
       ORDER BY recorded_at DESC
       LIMIT $3`,
      [tenantId, cutoff, limit],
    );
    return result.rows.map((r) => rowToRecord(r as Record<string, unknown>)).reverse();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.debug(`[semantic-audit-pg] load failed: ${msg}`);
    return [];
  }
}

export async function pgLabelSemanticAuditRecord(
  id: string,
  label: 'true_positive' | 'false_positive' | 'ignored',
  userId: string,
  tenantId?: string,
): Promise<boolean> {
  const pool = await getPool();
  if (!pool) return false;
  const tid = tenantId || resolveTenantId();
  try {
    const result = await pool.query(
      `UPDATE semantic_audit_outcomes
       SET labeled = true, label = $1, label_user_id = $2, label_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [label, userId, id, tid],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.debug(`[semantic-audit-pg] label failed: ${msg}`);
    return false;
  }
}

/** @internal test reset */
export function resetSemanticAuditPgForTests(): void {
  poolPromise = null;
}
