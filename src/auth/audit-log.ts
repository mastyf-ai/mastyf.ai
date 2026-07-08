import { getAuthDb, type AuthDbRow } from './db/auth-db.js';
import { Logger } from '../utils/logger.js';
import type { AuditLogEntry, AuditResult } from './rbac-types.js';

function rowToEntry(row: AuthDbRow): AuditLogEntry {
  let metadata: Record<string, unknown> | null = null;
  const raw = row['metadata'];
  if (raw) {
    try {
      metadata = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
    } catch {
      metadata = null;
    }
  }
  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    userId: (row['user_id'] as string | null) ?? null,
    username: (row['username'] as string | null) ?? null,
    action: String(row['action']),
    result: row['result'] as AuditResult,
    ipAddress: (row['ip_address'] as string | null) ?? null,
    userAgent: (row['user_agent'] as string | null) ?? null,
    metadata,
    createdAt: String(row['created_at']),
  };
}

export interface WriteAuditLogInput {
  tenantId?: string;
  userId?: string | null;
  username?: string | null;
  action: string;
  result: AuditResult;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export const auditLog = {
  async write(input: WriteAuditLogInput): Promise<void> {
    try {
      const db = await getAuthDb();
      await db.run(
        `INSERT INTO auth_audit_logs
          (id, tenant_id, user_id, username, action, result, ip_address, user_agent, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          db.newId(),
          input.tenantId ?? 'default',
          input.userId ?? null,
          input.username ?? null,
          input.action,
          input.result,
          input.ipAddress ?? null,
          input.userAgent ?? null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          db.nowIso(),
        ],
      );
    } catch (err) {
      // Audit logging must never break the request path it's observing.
      Logger.error(`[audit-log] Failed to write audit entry: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  async query(params: {
    tenantId?: string;
    userId?: string;
    action?: string;
    result?: AuditResult;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const db = await getAuthDb();
    const tenantId = params.tenantId ?? 'default';
    const conditions: string[] = ['tenant_id = ?'];
    const args: unknown[] = [tenantId];

    if (params.userId) {
      conditions.push('user_id = ?');
      args.push(params.userId);
    }
    if (params.action) {
      conditions.push('action = ?');
      args.push(params.action);
    }
    if (params.result) {
      conditions.push('result = ?');
      args.push(params.result);
    }
    if (params.since) {
      conditions.push('created_at >= ?');
      args.push(params.since);
    }
    if (params.until) {
      conditions.push('created_at <= ?');
      args.push(params.until);
    }

    const where = conditions.join(' AND ');
    const totalRow = await db.get(`SELECT COUNT(*) as c FROM auth_audit_logs WHERE ${where}`, args);
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
    const offset = Math.max(params.offset ?? 0, 0);
    const rows = await db.all(
      `SELECT * FROM auth_audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );
    return { entries: rows.map(rowToEntry), total: Number(totalRow?.['c'] ?? 0) };
  },
};
