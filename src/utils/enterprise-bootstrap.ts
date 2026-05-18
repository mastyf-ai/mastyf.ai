import { createSecretProvider } from '../auth/secret-provider.js';
import { PolicyAuditor } from './policy-auditor.js';
import { ExporterManager } from '../exporters/exporter-manager.js';
import { AuditTrailSync } from '../aggregator/audit-trail-sync.js';
import { HistoryDatabase } from '../database/history-db.js';
import { IDatabase } from '../database/database-interface.js';
import { registerReadinessCheck } from './readiness.js';
import { Logger } from './logger.js';
import { createRedisClient, isRedisConfigured } from './redis-client.js';
import {
  setAttackLearningSharedStore,
  loadAttackLearningFromSharedStore,
} from '../ai/instant-attack-learning.js';

let exporterManager: ExporterManager | null = null;
let policyAuditor: PolicyAuditor | null = null;
let auditTrailSync: AuditTrailSync | null = null;

const SECRET_KEYS = [
  'NVD_API_KEY',
  'ANTHROPIC_API_KEY',
  'DASHBOARD_API_KEY',
  'DASHBOARD_JWT_SECRET',
  'MCP_AUTH_JWT_SECRET',
  'JWT_SECRET',
  'ALERT_WEBHOOK_URL',
];

export async function bootstrapSecrets(): Promise<void> {
  const provider = createSecretProvider();
  const healthy = await provider.healthCheck();
  if (!healthy) {
    Logger.warn(`[bootstrap] Secret provider '${provider.name}' health check failed`);
    return;
  }

  for (const key of SECRET_KEYS) {
    if (process.env[key]) continue;
    const value = await provider.get(key);
    if (value) {
      process.env[key] = value;
      Logger.debug(`[bootstrap] Loaded secret ${key} from ${provider.name}`);
    }
  }
}

export async function bootstrapCompliance(db: IDatabase): Promise<void> {
  policyAuditor = new PolicyAuditor();
  exporterManager = new ExporterManager();
  await exporterManager.start();

  const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();
  if (
    dbType === 'sqlite' &&
    process.env['GUARDIAN_AUDIT_SYNC_ENABLED'] === 'true' &&
    process.env['DATABASE_URL'] &&
    db instanceof HistoryDatabase
  ) {
    auditTrailSync = new AuditTrailSync(db);
    await auditTrailSync.initialize();
    setAttackLearningSharedStore(auditTrailSync);
    await loadAttackLearningFromSharedStore();
    auditTrailSync.start();
    Logger.info('[bootstrap] Audit trail sync to PostgreSQL started');
  }

  if (isRedisConfigured()) {
    registerReadinessCheck(async () => {
      const redis = createRedisClient({
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
      });
      try {
        await redis.connect();
        const pong = await redis.ping();
        await redis.quit();
        return { ok: pong === 'PONG', detail: pong };
      } catch (err: any) {
        try {
          await redis.quit();
        } catch {
          // ignore
        }
        if (process.env['GUARDIAN_STRICT_MODE'] === 'true') {
          return { ok: false, detail: err?.message };
        }
        return { ok: true, detail: `redis optional: ${err?.message}` };
      }
    });
  }

  if ((process.env['DB_TYPE'] || 'sqlite') === 'postgres') {
    registerReadinessCheck(async () => {
      try {
        const { default: pg } = await import('pg');
        const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
        await pool.query('SELECT 1');
        await pool.end();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, detail: err?.message };
      }
    });
  }

  Logger.info('[bootstrap] Enterprise compliance modules initialized');
}

export function getPolicyAuditor(): PolicyAuditor | null {
  return policyAuditor;
}

export function getAuditTrailSync(): AuditTrailSync | null {
  return auditTrailSync;
}

export function getExporterManager(): ExporterManager | null {
  return exporterManager;
}

export async function shutdownEnterprise(): Promise<void> {
  if (auditTrailSync) {
    auditTrailSync.stop();
    auditTrailSync = null;
  }
  exporterManager = null;
  policyAuditor = null;
}

export async function exportSiemEvent(type: string, payload: Record<string, unknown>): Promise<void> {
  if (!exporterManager) return;
  await exporterManager.export({
    type,
    payload,
    timestamp: new Date().toISOString(),
  });
}
