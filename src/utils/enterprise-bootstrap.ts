import { createSecretProvider } from '../auth/secret-provider.js';
import { PolicyAuditor } from './policy-auditor.js';
import { ExporterManager } from '../exporters/exporter-manager.js';
import { AuditTrailSync } from '../aggregator/audit-trail-sync.js';
import { HistoryDatabase } from '../database/history-db.js';
import { IDatabase } from '../database/database-interface.js';
import { registerReadinessCheck } from './readiness.js';
import { Logger } from './logger.js';
import { createRedisClient, isRedisConfigured } from './redis-client.js';
import { assertEnterpriseLicensePosture } from '../license/feature-tiers.js';
import { maybeClearRugPullOnStart } from '../proxy/rug-pull-cluster.js';
import { MtlsCertWatcher } from './mtls-watcher.js';
import { getMtlsAgent } from './mtls-agent-registry.js';
import {
  setAttackLearningSharedStore,
  loadAttackLearningFromSharedStore,
} from '../ai/instant-attack-learning.js';
import { initUnifiedDataReaderPool, closeUnifiedDataReaderPool } from '../utils/unified-data-reader.js';
import {
  startInstanceRegistry,
  stopInstanceRegistry,
} from '../control-plane/instance-registry.js';
import {
  startPolicySubscriber,
  stopPolicySubscriber,
} from '../control-plane/policy-subscriber.js';
import type { PolicyWatcher } from '../policy/policy-watcher.js';

let exporterManager: ExporterManager | null = null;
let policyAuditor: PolicyAuditor | null = null;
let auditTrailSync: AuditTrailSync | null = null;
let mtlsWatcher: MtlsCertWatcher | null = null;

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
  assertEnterpriseLicensePosture();
  maybeClearRugPullOnStart();
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

  bootstrapMtlsHotReload();
  runEnterpriseSecurityPreflight();

  if (process.env['DATABASE_URL'] && process.env['DASHBOARD_ENABLED'] === 'true') {
    await initUnifiedDataReaderPool().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.warn(`[bootstrap] Unified data reader init skipped: ${msg}`);
    });
  }

  Logger.info('[bootstrap] Enterprise compliance modules initialized');
}

/** Startup warnings for production security posture (mcp tests 31 §3.5 / §3.1). */
function isMultiReplicaDeployment(): boolean {
  if (process.env.KUBERNETES_SERVICE_HOST) return true;
  const n = parseInt(process.env.GUARDIAN_REPLICA_COUNT || '1', 10);
  return Number.isFinite(n) && n > 1;
}

export function runEnterpriseSecurityPreflight(): void {
  assertEnterpriseLicensePosture();

  if (process.env.GUARDIAN_ENTERPRISE_MODE === 'true') {
    if (!isRedisConfigured()) {
      const msg =
        '[bootstrap] GUARDIAN_ENTERPRISE_MODE=true but REDIS_URL is unset — session flow, distributed rate limits, and policy cache are per-instance only';
      if (process.env.GUARDIAN_STRICT_MODE === 'true' || isMultiReplicaDeployment()) {
        throw new Error(msg);
      }
      Logger.warn(msg);
    }
    if (process.env.GUARDIAN_POLICY_EVAL_CACHE_LEGACY_HEURISTIC === 'true') {
      Logger.warn(
        '[bootstrap] GUARDIAN_POLICY_EVAL_CACHE_LEGACY_HEURISTIC=true in enterprise — prefer opt-in rule.cacheable only',
      );
    }
  }

  const jwtMaxSec = parseInt(process.env.GUARDIAN_JWT_MAX_LIFETIME_SEC || '86400', 10);
  if (Number.isFinite(jwtMaxSec) && jwtMaxSec > 86400) {
    const msg = `[bootstrap] GUARDIAN_JWT_MAX_LIFETIME_SEC=${jwtMaxSec} exceeds 86400 — long-lived tokens increase replay risk`;
    if (process.env.GUARDIAN_JWT_STRICT_LIFETIME === 'true') {
      throw new Error(msg);
    }
    Logger.warn(msg);
  }
  if (
    process.env.NODE_ENV === 'production'
    && process.env.GUARDIAN_SEMANTIC_SYNC_RESPONSE === 'false'
  ) {
    Logger.warn(
      '[bootstrap] GUARDIAN_SEMANTIC_SYNC_RESPONSE=false in production — tool responses bypass sync semantic gate',
    );
  }
}

export async function bootstrapControlPlane(
  policyWatcher?: PolicyWatcher | null,
): Promise<void> {
  startInstanceRegistry(async () => {
    const { collectHeartbeatThreatSignatures } = await import('../utils/fleet-threat-signatures.js');
    const { collectFederatedThreatStats } = await import('../utils/federated-threat-radar.js');
    const [threatSignatures, federatedStats] = await Promise.all([
      collectHeartbeatThreatSignatures().catch(() => []),
      collectFederatedThreatStats().catch(() => null),
    ]);
    return {
      threatSignatures,
      ...(federatedStats ? { federatedStats } : {}),
    };
  });
  const tenantSlug = process.env['GUARDIAN_TENANT_ID'] || 'default';
  startPolicySubscriber(tenantSlug, policyWatcher ?? null);
}

/** Start mTLS cert watcher and prime shared HTTPS agent for HTTP/SSE proxies. */
export function bootstrapMtlsHotReload(): void {
  if (process.env['MCP_TLS_ENABLED'] !== 'true') return;
  if (process.env['GUARDIAN_MTLS_HOT_RELOAD'] === 'false') return;
  try {
    getMtlsAgent();
    mtlsWatcher = new MtlsCertWatcher();
    mtlsWatcher.start({
      caPath: process.env['MCP_TLS_CA'],
      certPath: process.env['MCP_TLS_CERT'],
      keyPath: process.env['MCP_TLS_KEY'],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.warn(`[bootstrap] mTLS hot-reload not started: ${msg}`);
  }
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
  mtlsWatcher?.stop();
  mtlsWatcher = null;
  const { stopDashboardTelemetry } = await import('./dashboard-telemetry.js');
  await stopDashboardTelemetry();
  if (auditTrailSync) {
    auditTrailSync.stop();
    auditTrailSync = null;
  }
  stopInstanceRegistry();
  stopPolicySubscriber();
  await closeUnifiedDataReaderPool();
  exporterManager = null;
  policyAuditor = null;
}

export async function exportSiemEvent(type: string, payload: Record<string, unknown>): Promise<void> {
  const { appendSiemChainedEvent } = await import('./audit-hash-chain.js');
  appendSiemChainedEvent(type, payload);
  if (!exporterManager) return;
  await exporterManager.export({
    type,
    payload,
    timestamp: new Date().toISOString(),
  });
}
