import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { cloudDbAvailable, getDb } from '@/lib/db';

export type DeepScanJobStatus = 'pending' | 'running' | 'done' | 'failed';

export type DeepScanJob = {
  id: string;
  packageName: string;
  orgId: string | null;
  status: DeepScanJobStatus;
  resultJson: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

function rowToJob(row: Record<string, unknown>): DeepScanJob {
  return {
    id: String(row.id),
    packageName: String(row.package_name),
    orgId: row.org_id != null ? String(row.org_id) : null,
    status: String(row.status) as DeepScanJobStatus,
    resultJson: (row.result_json as Record<string, unknown> | null) ?? null,
    error: row.error != null ? String(row.error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at != null ? String(row.started_at) : null,
    completedAt: row.completed_at != null ? String(row.completed_at) : null,
  };
}

export function deepScanQueueAvailable(): boolean {
  return cloudDbAvailable();
}

export async function enqueueDeepScan(
  packageName: string,
  orgId?: string | null,
): Promise<DeepScanJob> {
  const id = randomUUID();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO deep_scan_jobs (id, package_name, org_id, status)
    VALUES (${id}, ${packageName}, ${orgId ?? null}, 'pending')
  `);
  const job = await getJob(id);
  if (!job) throw new Error('deep_scan_enqueue_failed');
  return job;
}

export async function getJob(id: string): Promise<DeepScanJob | null> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT id, package_name, org_id, status, result_json, error,
           created_at, updated_at, started_at, completed_at
    FROM deep_scan_jobs
    WHERE id = ${id}
    LIMIT 1
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return row ? rowToJob(row) : null;
}

export async function claimNextJob(): Promise<DeepScanJob | null> {
  const db = getDb();
  const rows = await db.execute(sql`
    UPDATE deep_scan_jobs
    SET status = 'running',
        started_at = NOW(),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM deep_scan_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, package_name, org_id, status, result_json, error,
              created_at, updated_at, started_at, completed_at
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0];
  return row ? rowToJob(row) : null;
}

export async function completeJob(
  id: string,
  result: { ok: true; result: Record<string, unknown> } | { ok: false; error: string },
): Promise<void> {
  const db = getDb();
  if (result.ok) {
    await db.execute(sql`
      UPDATE deep_scan_jobs
      SET status = 'done',
          result_json = ${JSON.stringify(result.result)}::jsonb,
          error = NULL,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
    `);
    return;
  }
  await db.execute(sql`
    UPDATE deep_scan_jobs
    SET status = 'failed',
        error = ${result.error},
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${id}
  `);
}

export async function countPendingJobs(): Promise<number> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM deep_scan_jobs WHERE status = 'pending'
  `);
  return Number((rows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0);
}
