import { createSecretProvider, isManagedSecretProviderConfigured } from '../auth/secret-provider.js';
import { PolicyAuditor } from './policy-auditor.js';
import { ExporterManager } from '../exporters/exporter-manager.js';
import { AuditTrailSync } from '../aggregator/audit-trail-sync.js';
import { HistoryDatabase } from '../database/history-db.js';
import { registerReadinessCheck } from './readiness.js';
import { Logger } from './logger.js';
import { createRedisClient, isRedisConfigured } from './redis-client.js';
import { assertEnterpriseLicensePosture } from '../license/feature-tiers.js';
import { maybeClearRugPullOnStart } from '../proxy/rug-pull-cluster.js';
import { MtlsCertWatcher } from './mtls-watcher.js';
import { getMtlsAgent } from './mtls-agent-registry.js';
import { setAttackLearningSharedStore, loadAttackLearningFromSharedStore, } from '../ai/instant-attack-learning.js';
import { initUnifiedDataReaderPool, closeUnifiedDataReaderPool } from '../utils/unified-data-reader.js';
import { startInstanceRegistry, stopInstanceRegistry, } from '../control-plane/instance-registry.js';
import { startPolicySubscriber, stopPolicySubscriber, } from '../control-plane/policy-subscriber.js';
import { getAlertDestinationsForLogging, isAppAlertingConfigured } from '../alerting/alert-env.js';
import { isFieldEncryptionEnabled } from './field-encryption.js';
import { applySemanticSecurityProfile } from '../tenant/semantic-security-profile.js';
let exporterManager = null;
let policyAuditor = null;
let auditTrailSync = null;
let mtlsWatcher = null;
const SECRET_KEYS = [
    'NVD_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'DASHBOARD_API_KEY',
    'DASHBOARD_JWT_SECRET',
    'MCP_AUTH_JWT_SECRET',
    'JWT_SECRET',
    'ALERT_WEBHOOK_URL',
    'ALERT_SLACK_WEBHOOK',
    'ALERT_PAGERDUTY_KEY',
    'MASTYF_AI_DB_ENCRYPTION_KEY',
    'MASTYF_AI_MANIFEST_SECRET',
];
export async function bootstrapSecrets() {
    assertEnterpriseLicensePosture();
    maybeClearRugPullOnStart();
    const provider = createSecretProvider();
    const healthy = await provider.healthCheck();
    if (!healthy) {
        Logger.warn(`[bootstrap] Secret provider '${provider.name}' health check failed`);
        return;
    }
    for (const key of SECRET_KEYS) {
        if (process.env[key])
            continue;
        const value = await provider.get(key);
        if (value) {
            process.env[key] = value;
            Logger.debug(`[bootstrap] Loaded secret ${key} from ${provider.name}`);
        }
    }
    const { startLlmSecretRefreshTimer } = await import('../config/llm-config.js');
    startLlmSecretRefreshTimer();
}
export async function bootstrapCompliance(db) {
    applySemanticSecurityProfile();
    const { initTracing } = await import('./tracing.js');
    await initTracing();
    policyAuditor = new PolicyAuditor();
    exporterManager = new ExporterManager();
    await exporterManager.start();
    const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();
    if (dbType === 'sqlite' &&
        process.env['MASTYF_AI_AUDIT_SYNC_ENABLED'] === 'true' &&
        process.env['DATABASE_URL'] &&
        db instanceof HistoryDatabase) {
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
            }
            catch (err) {
                try {
                    await redis.quit();
                }
                catch {
                    // ignore
                }
                if (process.env['MASTYF_AI_STRICT_MODE'] === 'true') {
                    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
                }
                return { ok: true, detail: `redis optional: ${err instanceof Error ? err.message : String(err)}` };
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
            }
            catch (err) {
                return { ok: false, detail: err instanceof Error ? err.message : String(err) };
            }
        });
    }
    bootstrapMtlsHotReload();
    runEnterpriseSecurityPreflight();
    if (process.env['DATABASE_URL'] && process.env['DASHBOARD_ENABLED'] === 'true') {
        await initUnifiedDataReaderPool().catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            Logger.warn(`[bootstrap] Unified data reader init skipped: ${msg}`);
        });
    }
    Logger.info('[bootstrap] Enterprise compliance modules initialized');
    const { warnLocalSemanticQueueCapsIfNeeded } = await import('./redis-semantic-queue.js');
    warnLocalSemanticQueueCapsIfNeeded();
    const { isSemanticLlmConfigured, reportSemanticDegradation } = await import('./semantic-layer.js');
    const { isSemanticAsyncEnabledForTenant } = await import('../tenant/tenant-semantic-config.js');
    const { isSyncSemanticRequestEnabled } = await import('../ai/sync-semantic-request.js');
    const semanticEnabled = isSyncSemanticRequestEnabled() || isSemanticAsyncEnabledForTenant();
    if (semanticEnabled && !isSemanticLlmConfigured()) {
        reportSemanticDegradation('llm_unavailable_at_startup');
        Logger.warn('[bootstrap] semantic_layer_active=false — LLM API key missing or disabled (M-002)');
    }
    const { getLlmConfig } = await import('../config/llm-config.js');
    const llmCfg = getLlmConfig();
    if (llmCfg.provider === 'ollama'
        && (process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true' || process.env['MASTYF_AI_STRICT_MODE'] === 'true')) {
        Logger.warn('[bootstrap] Ollama semantic backend in enterprise — frontier model APIs recommended for production (M-011)');
        registerReadinessCheck(async () => ({
            ok: true,
            detail: 'ollama_semantic_backend',
        }));
    }
    const { startTribunalSlaSweep } = await import('./tribunal-sla.js');
    startTribunalSlaSweep();
}
/** Startup warnings for production security posture (mcp tests 31 §3.5 / §3.1). */
export function isMultiReplicaDeployment() {
    for (const key of ['MASTYF_AI_REPLICA_COUNT', 'REPLICA_COUNT']) {
        const n = parseInt(process.env[key] || '1', 10);
        if (Number.isFinite(n) && n > 1)
            return true;
    }
    return false;
}
export function runEnterpriseSecurityPreflight() {
    assertEnterpriseLicensePosture();
    if (process.env.MASTYF_AI_ENTERPRISE_MODE === 'true') {
        if (!isManagedSecretProviderConfigured()) {
            const msg = '[bootstrap] MASTYF_AI_ENTERPRISE_MODE=true requires managed secrets provider (set MASTYF_AI_SECRET_PROVIDER=hashicorp-vault|aws-secrets-manager|gcp-secret-manager)';
            if (process.env.MASTYF_AI_ALLOW_ENV_SECRETS_IN_ENTERPRISE === 'true') {
                Logger.warn(`${msg} (temporary override via MASTYF_AI_ALLOW_ENV_SECRETS_IN_ENTERPRISE=true)`);
            }
            else {
                throw new Error(msg);
            }
        }
        if (!isRedisConfigured()) {
            const msg = '[bootstrap] MASTYF_AI_ENTERPRISE_MODE=true but REDIS_URL is unset — session flow, distributed rate limits, and policy cache are per-instance only';
            if (process.env.MASTYF_AI_STRICT_MODE === 'true' || isMultiReplicaDeployment()) {
                throw new Error(msg);
            }
            Logger.warn(msg);
        }
        if (process.env.MASTYF_AI_POLICY_EVAL_CACHE_LEGACY_HEURISTIC === 'true') {
            Logger.warn('[bootstrap] MASTYF_AI_POLICY_EVAL_CACHE_LEGACY_HEURISTIC=true in enterprise — prefer opt-in rule.cacheable only');
        }
    }
    const jwtMaxSec = parseInt(process.env.MASTYF_AI_JWT_MAX_LIFETIME_SEC || '86400', 10);
    if (Number.isFinite(jwtMaxSec) && jwtMaxSec > 86400) {
        const msg = `[bootstrap] MASTYF_AI_JWT_MAX_LIFETIME_SEC=${jwtMaxSec} exceeds 86400 — long-lived tokens increase replay risk`;
        if (process.env.MASTYF_AI_JWT_STRICT_LIFETIME === 'true') {
            throw new Error(msg);
        }
        Logger.warn(msg);
    }
    if (process.env.NODE_ENV === 'production'
        && process.env.MASTYF_AI_SEMANTIC_SYNC_RESPONSE === 'false') {
        Logger.warn('[bootstrap] MASTYF_AI_SEMANTIC_SYNC_RESPONSE=false in production — tool responses bypass sync semantic gate');
    }
    assertSQLiteMultiReplicaSafety();
    assertStrictUpstreamTlsPosture();
    assertMultiTenantGatewayAuth();
    assertEnterpriseRateLimitRedis();
    assertAlertingConfigured();
    assertEnterpriseEncryptionConfigured();
    assertEnterpriseSemanticStrict();
}
function assertEnterpriseSemanticStrict() {
    if (process.env['MASTYF_AI_ENTERPRISE_MODE'] !== 'true')
        return;
    if (process.env['MASTYF_AI_SEMANTIC_STRICT'] !== 'true') {
        throw new Error('[bootstrap] MASTYF_AI_ENTERPRISE_MODE=true requires MASTYF_AI_SEMANTIC_STRICT=true (max-security semantic profile)');
    }
}
function assertEnterpriseEncryptionConfigured() {
    if (process.env['MASTYF_AI_ENTERPRISE_MODE'] !== 'true')
        return;
    if (!isFieldEncryptionEnabled()) {
        throw new Error('[bootstrap] MASTYF_AI_ENTERPRISE_MODE=true requires MASTYF_AI_DB_ENCRYPTION_KEY for field-level encryption at rest');
    }
}
function assertAlertingConfigured() {
    const alertingRequired = process.env['MASTYF_AI_ALERTING_REQUIRED'] === 'true'
        || (process.env['MASTYF_AI_ENTERPRISE_MODE'] === 'true' && process.env['MASTYF_AI_STRICT_MODE'] === 'true');
    if (!alertingRequired)
        return;
    if (process.env['MASTYF_AI_CLUSTER_ALERTING_ONLY'] === 'true') {
        Logger.info('[bootstrap] App alerting optional — MASTYF_AI_CLUSTER_ALERTING_ONLY=true (Prometheus/Alertmanager)');
        return;
    }
    if (!isAppAlertingConfigured()) {
        throw new Error('[bootstrap] Alerting required but no destinations configured — set ALERT_SLACK_WEBHOOK and/or ALERT_PAGERDUTY_KEY (or MASTYF_AI_CLUSTER_ALERTING_ONLY=true for cluster-only routing)');
    }
    Logger.info(`[bootstrap] App alerting configured: ${getAlertDestinationsForLogging()}`);
}
function assertStrictUpstreamTlsPosture() {
    if (process.env['MASTYF_AI_STRICT_MODE'] !== 'true')
        return;
    if (process.env['MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM'] === 'true') {
        throw new Error('[bootstrap] MASTYF_AI_STRICT_MODE=true ignores MASTYF_AI_ALLOW_PLAINTEXT_UPSTREAM — use https:// upstreams only');
    }
}
function assertMultiTenantGatewayAuth() {
    if (process.env['MASTYF_AI_MULTI_TENANT_ENABLED'] !== 'true')
        return;
    if (process.env['MASTYF_AI_GATEWAY_MODE'] !== 'true')
        return;
    if (process.env['MASTYF_AI_AUTH_REQUIRED'] !== 'true') {
        throw new Error('[bootstrap] Multi-tenant gateway requires MASTYF_AI_AUTH_REQUIRED=true on all ingress paths');
    }
}
function assertEnterpriseRateLimitRedis() {
    if (process.env['MASTYF_AI_GLOBAL_RATE_LIMIT_REQUIRED'] !== 'true')
        return;
    if (isRedisConfigured())
        return;
    throw new Error('[bootstrap] MASTYF_AI_GLOBAL_RATE_LIMIT_REQUIRED=true but REDIS_URL/Sentinel/Cluster is unset');
}
function assertSQLiteMultiReplicaSafety() {
    const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();
    if (dbType !== 'sqlite')
        return;
    if (!isMultiReplicaDeployment())
        return;
    const msg = '[bootstrap] SQLite history DB is unsafe with multiple replicas (lock contention/corruption). '
        + 'Use DB_TYPE=postgres, per-instance MASTYF_AI_DB_PATH, or MASTYF_AI_AUDIT_SYNC_ENABLED=true with DATABASE_URL. '
        + 'See deploy/DEPLOYMENT.md';
    if (process.env.MASTYF_AI_STRICT_MODE === 'true'
        || process.env.MASTYF_AI_ENTERPRISE_MODE === 'true') {
        throw new Error(msg);
    }
    Logger.warn(msg);
}
export async function bootstrapControlPlane(policyWatcher) {
    startInstanceRegistry(async () => {
        const { collectHeartbeatThreatSignatures } = await import('../utils/fleet-threat-signatures.js');
        const { collectFederatedThreatStats } = await import('../utils/federated-threat-radar.js');
        const { collectProxyHeartbeatMetrics } = await import('../utils/heartbeat-proxy-metrics.js');
        const [threatSignatures, federatedStats, proxyMetrics] = await Promise.all([
            collectHeartbeatThreatSignatures().catch(() => []),
            collectFederatedThreatStats().catch(() => null),
            collectProxyHeartbeatMetrics().catch(() => ({})),
        ]);
        return {
            ...proxyMetrics,
            threatSignatures,
            ...(federatedStats ? { federatedStats } : {}),
        };
    });
    const tenantSlug = process.env['MASTYF_AI_TENANT_ID'] || 'default';
    startPolicySubscriber(tenantSlug, policyWatcher ?? null);
}
/** Start mTLS cert watcher and prime shared HTTPS agent for HTTP/SSE proxies. */
export function bootstrapMtlsHotReload() {
    if (process.env['MCP_TLS_ENABLED'] !== 'true')
        return;
    if (process.env['MASTYF_AI_MTLS_HOT_RELOAD'] === 'false')
        return;
    try {
        getMtlsAgent();
        mtlsWatcher = new MtlsCertWatcher();
        mtlsWatcher.start({
            caPath: process.env['MCP_TLS_CA'],
            certPath: process.env['MCP_TLS_CERT'],
            keyPath: process.env['MCP_TLS_KEY'],
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Logger.warn(`[bootstrap] mTLS hot-reload not started: ${msg}`);
    }
}
export function getPolicyAuditor() {
    return policyAuditor;
}
export function getAuditTrailSync() {
    return auditTrailSync;
}
export function getExporterManager() {
    return exporterManager;
}
export async function shutdownEnterprise() {
    const { shutdownLearnedRules } = await import('../ai/learned-rules-init.js');
    shutdownLearnedRules();
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
    const { shutdownTracing } = await import('./tracing.js');
    await shutdownTracing();
    exporterManager = null;
    policyAuditor = null;
}
export async function exportSiemEvent(type, payload) {
    const { appendSiemChainedEvent } = await import('./audit-hash-chain.js');
    appendSiemChainedEvent(type, payload);
    if (type === 'policy_decision' || type === 'tool_blocked') {
        const { exportPolicyDecision } = await import('../exporters/siem-exporter.js');
        const decision = payload['decision'];
        const context = payload['context'];
        exportPolicyDecision({
            timestamp: new Date().toISOString(),
            action: decision?.action ?? (type === 'tool_blocked' ? 'block' : 'pass'),
            rule: decision?.rule ?? String(payload['rule'] ?? 'unknown'),
            reason: decision?.reason ?? String(payload['reason'] ?? ''),
            serverName: String(payload['serverName'] ?? ''),
            toolName: String(payload['toolName'] ?? ''),
            tenantId: context?.tenantId ?? String(payload['tenantId'] ?? 'default'),
            requestId: String(payload['requestId'] ?? ''),
            agentIdentity: context?.agentIdentity,
        });
    }
    if (!exporterManager)
        return;
    await exporterManager.export({
        type,
        payload,
        timestamp: new Date().toISOString(),
    });
}
//# sourceMappingURL=enterprise-bootstrap.js.map