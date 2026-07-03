/**
 * Audit Trail Sync — periodically syncs per-instance SQLite history
 * databases to the central PostgreSQL unified_audit_trail table.
 *
 * This ensures all policy decisions, call records, security scans,
 * cost records, and health checks are aggregated in one place.
 */
import { HistoryDatabase } from '../database/history-db.js';
import { loadPg, type PgPoolType } from '../database/pg-loader.js';
import { runMigrations } from '../database/migration-runner.js';
import { Logger } from '../utils/logger.js';
import { ProxyCallRecord } from '../types.js';
import type { AttackLearningState } from '../ai/instant-attack-learning.js';
import { getMastyfAiRegion } from '../utils/region.js';

export interface SyncConfig {
  instanceId: string;
  instanceName: string;
  syncIntervalMs: number;
  batchSize: number;
  databaseUrl: string;
}

const DEFAULT_CONFIG: SyncConfig = {
  instanceId: process.env['MASTYF_AI_INSTANCE_ID'] || `mastyf-ai-${process.pid}-${Date.now()}`,
  instanceName: process.env['MASTYF_AI_INSTANCE_NAME'] || process.env['HOSTNAME'] || 'unknown',
  syncIntervalMs: parseInt(process.env['MASTYF_AI_SYNC_INTERVAL_MS'] || '30000', 10),
  batchSize: parseInt(process.env['MASTYF_AI_SYNC_BATCH_SIZE'] || '100', 10),
  databaseUrl: process.env['DATABASE_URL'] || 'postgresql://localhost:5432/mastyf_ai',
};

export class AuditTrailSync {
  private localDb: HistoryDatabase;
  private pgPool!: PgPoolType;
  private config: SyncConfig;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(localDb: HistoryDatabase, config?: Partial<SyncConfig>) {
    this.localDb = localDb;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Region label stored in mastyf_ai_instances.metadata for dashboard region filter. */
  private instanceMetadata(): Record<string, string> {
    return { region: getMastyfAiRegion() };
  }

  async initialize(): Promise<void> {
    const { Pool } = await loadPg();
    this.pgPool = new Pool({
      connectionString: this.config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
    });

    await runMigrations(this.pgPool);

    const client = await this.pgPool.connect();
    try {
      // Register this instance
      await client.query(
        `INSERT INTO mastyf_ai_instances (instance_id, instance_name, hostname, version, started_at, last_heartbeat, status, metadata)
         VALUES ($1, $2, $3, $4, NOW(), NOW(), 'active', $5::jsonb)
         ON CONFLICT (instance_id) DO UPDATE
         SET last_heartbeat = NOW(), status = 'active', hostname = $3, version = $4,
             metadata = COALESCE(mastyf_ai_instances.metadata, '{}'::jsonb) || EXCLUDED.metadata`,
        [
          this.config.instanceId,
          this.config.instanceName,
          process.env['HOSTNAME'] || 'unknown',
          process.env.npm_package_version || '2.3.24',
          JSON.stringify(this.instanceMetadata()),
        ],
      );

      Logger.info(`[AuditTrailSync] Initialized — instance: ${this.config.instanceId}, sync interval: ${this.config.syncIntervalMs}ms`);
    } finally {
      client.release();
    }
  }

  /** Start periodic sync */
  start(): void {
    if (this.syncTimer) return;
    this.syncTimer = setInterval(() => {
      this.syncAll().catch(err => {
        Logger.error(`[AuditTrailSync] Sync failed: ${err?.message}`);
      });
    }, this.config.syncIntervalMs);
    // Run initial sync immediately
    this.syncAll().catch(err => {
      Logger.error(`[AuditTrailSync] Initial sync failed: ${err?.message}`);
    });
  }

  /** Stop periodic sync */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /** Sync all data types to central PG */
  async syncAll(): Promise<void> {
    await Promise.all([
      this.syncCallRecords(),
      this.syncSecurityScans(),
      this.syncCostRecords(),
      this.syncHealthChecks(),
      this.sendHeartbeat(),
    ]);
  }

  /** Sync call records from local SQLite to unified_audit_trail */
  private async syncCallRecords(): Promise<void> {
    try {
      const tenants = this.localDb.getDistinctAuditTenants();
      for (const tenantId of tenants.length > 0 ? tenants : ['default']) {
        const servers = this.localDb.getDistinctServersForTenant(tenantId);
        for (const serverName of servers) {
          const client = await this.pgPool.connect();
          try {
            const cursorRes = await client.query(
              `SELECT last_source_id FROM audit_sync_cursors
               WHERE instance_id = $1 AND tenant_id = $2 AND server_name = $3`,
              [this.config.instanceId, tenantId, serverName],
            );
            const afterId = Number(cursorRes.rows[0]?.last_source_id) || 0;

            const records = await this.localDb.getCallRecordsAfterId(
              serverName,
              afterId,
              this.config.batchSize,
              tenantId,
            );
            if (records.length === 0) continue;

            await client.query('BEGIN');
            let maxId = afterId;
            for (const record of records) {
              if (record.sourceId > maxId) maxId = record.sourceId;
              const action = record.blocked ? 'block' : 'pass';
              const severity = record.blocked ? 'warn' : 'info';
              await client.query(
                `INSERT INTO unified_audit_trail
               (instance_id, server_name, tool_name, action, rule_name, reason,
                request_tokens, response_tokens, total_tokens, duration_ms,
                estimated_cost_usd, model, severity, tenant_id, timestamp, source_record_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
               ON CONFLICT DO NOTHING`,
                [
                  this.config.instanceId,
                  record.serverName,
                  record.toolName,
                  action,
                  record.blockRule ?? null,
                  record.blockReason ?? null,
                  record.requestTokens,
                  record.responseTokens,
                  record.totalTokens,
                  record.durationMs,
                  record.costUsd ?? 0,
                  record.model ?? null,
                  severity,
                  record.tenantId || tenantId,
                  record.timestamp || new Date().toISOString(),
                  record.sourceId,
                ],
              );
            }
            await client.query(
              `INSERT INTO audit_sync_cursors (instance_id, tenant_id, server_name, last_source_id, last_synced_at)
               VALUES ($1, $2, $3, $4, NOW())
               ON CONFLICT (instance_id, tenant_id, server_name)
               DO UPDATE SET last_source_id = GREATEST(audit_sync_cursors.last_source_id, EXCLUDED.last_source_id),
                             last_synced_at = NOW()`,
              [this.config.instanceId, tenantId, serverName, maxId],
            );
            await client.query('COMMIT');
            Logger.debug(
              `[AuditTrailSync] Synced ${records.length} call records for ${serverName} (tenant=${tenantId}, afterId=${afterId})`,
            );
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          } finally {
            client.release();
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Call record sync error: ${message}`);
    }
  }

  /** Sync security scans to unified_security_scans */
  private async syncSecurityScans(): Promise<void> {
    try {
      const tenants = this.localDb.getDistinctAuditTenants();
      for (const tenantId of tenants.length > 0 ? tenants : ['default']) {
        const servers = this.localDb.getDistinctServersForTenant(tenantId);
        for (const serverName of servers) {
          const scan = await this.localDb.getLatestSecurityScan(serverName, tenantId);
          if (!scan) continue;

          const s = scan as any;
          const client = await this.pgPool.connect();
          try {
            await client.query(
              `INSERT INTO unified_security_scans
             (instance_id, server_name, score, cve_count, details, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
              [
                this.config.instanceId,
                serverName,
                s.score || 0,
                s.cve_count ?? s.cves_found ?? 0,
                JSON.stringify(s.details || {}),
                tenantId,
              ],
            );
          } finally {
            client.release();
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Security scan sync error: ${message}`);
    }
  }

  /** Sync cost records to unified_cost_records */
  private async syncCostRecords(): Promise<void> {
    try {
      const tenants = this.localDb.getDistinctAuditTenants();
      for (const tenantId of tenants.length > 0 ? tenants : ['default']) {
        const servers = this.localDb.getDistinctServersForTenant(tenantId);
        for (const serverName of servers) {
          const client = await this.pgPool.connect();
          try {
            const cursorRes = await client.query(
              `SELECT last_source_id FROM audit_sync_cursors
               WHERE instance_id = $1 AND tenant_id = $2 AND server_name = $3`,
              [this.config.instanceId, tenantId, serverName],
            );
            const afterId = Number(cursorRes.rows[0]?.last_source_id) || 0;
            const records = await this.localDb.getCallRecordsAfterId(
              serverName,
              afterId,
              this.config.batchSize,
              tenantId,
            );
            if (records.length === 0) continue;

            const totalTokens = records.reduce((s, r) => s + r.totalTokens, 0);
            const inputTokens = records.reduce((s, r) => s + r.requestTokens, 0);
            const outputTokens = records.reduce((s, r) => s + r.responseTokens, 0);
            const costUsd = records.reduce((s, r) => s + (Number(r.costUsd) || 0), 0);

            await client.query(
              `INSERT INTO unified_cost_records
             (instance_id, server_name, tokens_used, input_tokens, output_tokens, cost_usd, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO NOTHING`,
              [
                this.config.instanceId,
                serverName,
                totalTokens,
                inputTokens,
                outputTokens,
                costUsd,
                tenantId,
              ],
            );
          } finally {
            client.release();
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Cost record sync error: ${message}`);
    }
  }

  /** Sync health checks to unified_health_checks */
  private async syncHealthChecks(): Promise<void> {
    try {
      const tenants = this.localDb.getDistinctAuditTenants();
      for (const tenantId of tenants.length > 0 ? tenants : ['default']) {
        const servers = this.localDb.getDistinctServersForTenant(tenantId);
        for (const serverName of servers) {
          const successRate = await this.localDb.getRecentSuccessRate(serverName, tenantId);
          if (successRate === null) continue;
          const health = await this.localDb.getLatestHealthCheck(serverName, tenantId);
          const latencyMs = health?.latency_ms;
          const toolCount = health?.tool_count;
          if (!Number.isFinite(latencyMs) || !Number.isFinite(toolCount)) {
            Logger.debug(
              `[AuditTrailSync] Skipping unified health for ${serverName}: measured latency/tool count unavailable`,
            );
            continue;
          }

          const client = await this.pgPool.connect();
          try {
            await client.query(
              `INSERT INTO unified_health_checks
             (instance_id, server_name, latency_ms, success, success_rate, tool_count, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO NOTHING`,
              [
                this.config.instanceId,
                serverName,
                latencyMs,
                successRate > 0.5,
                successRate,
                toolCount,
                tenantId,
              ],
            );
          } finally {
            client.release();
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Health check sync error: ${message}`);
    }
  }

  /** Send heartbeat to keep instance status active */
  private async sendHeartbeat(): Promise<void> {
    try {
      const client = await this.pgPool.connect();
      try {
        await client.query(
          `UPDATE mastyf_ai_instances
           SET last_heartbeat = NOW(), status = $2,
               metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
           WHERE instance_id = $1`,
          [this.config.instanceId, 'active', JSON.stringify(this.instanceMetadata())],
        );
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Heartbeat failed: ${message}`);
    }
  }

  /** Insert a policy decision directly into unified_audit_trail (real-time) */
  async recordPolicyDecision(decision: {
    serverName: string;
    toolName: string;
    action: 'pass' | 'block' | 'flag' | 'error';
    ruleName?: string;
    reason?: string;
    requestTokens?: number;
    responseTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    estimatedCostUsd?: number;
    model?: string;
    clientIp?: string;
    authSuccess?: boolean;
    severity?: 'info' | 'warn' | 'critical' | 'emergency';
    metadata?: Record<string, unknown>;
    tenantId?: string;
  }): Promise<void> {
    try {
      const client = await this.pgPool.connect();
      try {
        await client.query(
          `INSERT INTO unified_audit_trail
           (instance_id, server_name, tool_name, action, rule_name, reason,
            request_tokens, response_tokens, total_tokens, duration_ms,
            estimated_cost_usd, model, client_ip, auth_success, severity, metadata, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            this.config.instanceId,
            decision.serverName,
            decision.toolName,
            decision.action,
            decision.ruleName || null,
            decision.reason || null,
            decision.requestTokens || 0,
            decision.responseTokens || 0,
            decision.totalTokens || 0,
            decision.durationMs || 0,
            decision.estimatedCostUsd || 0,
            decision.model || null,
            decision.clientIp || null,
            decision.authSuccess ?? null,
            decision.severity || 'info',
            JSON.stringify(decision.metadata || {}),
            decision.tenantId || process.env['MASTYF_AI_TENANT_ID'] || 'default',
          ]
        );
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Decision record failed: ${message}`);
    }
  }

  /** Record AI learning outcome to shared PG */
  async recordLearningOutcome(outcome: {
    suggestionId: string;
    ruleName: string;
    source: 'baseline' | 'cost' | 'threat' | 'assist' | 'pattern';
    action: 'applied' | 'rejected' | 'modified' | 'ignored';
    confidence: number;
    userFeedback?: string;
  }): Promise<void> {
    try {
      const client = await this.pgPool.connect();
      try {
        await client.query(
          `INSERT INTO ai_learning_outcomes_shared
           (instance_id, suggestion_id, rule_name, source, action, confidence, user_feedback)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            this.config.instanceId,
            outcome.suggestionId,
            outcome.ruleName,
            outcome.source,
            outcome.action,
            outcome.confidence,
            outcome.userFeedback || null,
          ]
        );
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Learning outcome failed: ${message}`);
    }
  }

  /** Persist baseline to shared PG */
  async persistBaseline(baseline: {
    serverName: string;
    toolName: string;
    sampleCount: number;
    avgTokens: number;
    stddevTokens: number;
    avgLatencyMs: number;
    stddevLatencyMs: number;
    hourlyDistribution: number[];
    argumentKeys: string[];
  }): Promise<void> {
    try {
      const client = await this.pgPool.connect();
      try {
        await client.query(
          `INSERT INTO ai_baselines_shared
           (instance_id, server_name, tool_name, sample_count, avg_tokens, stddev_tokens,
            avg_latency_ms, stddev_latency_ms, hourly_distribution, argument_keys)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (server_name, tool_name) DO UPDATE
           SET instance_id = $1, sample_count = $4, avg_tokens = $5, stddev_tokens = $6,
               avg_latency_ms = $7, stddev_latency_ms = $8,
               hourly_distribution = $9, argument_keys = $10, last_updated = NOW()`,
          [
            this.config.instanceId,
            baseline.serverName,
            baseline.toolName,
            baseline.sampleCount,
            baseline.avgTokens,
            baseline.stddevTokens,
            baseline.avgLatencyMs,
            baseline.stddevLatencyMs,
            JSON.stringify(baseline.hourlyDistribution),
            JSON.stringify(baseline.argumentKeys),
          ]
        );
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Baseline persist failed: ${message}`);
    }
  }

  /** Get all baselines from shared PG (across all instances) */
  async getSharedBaselines(): Promise<any[]> {
    try {
      const client = await this.pgPool.connect();
      try {
        const result = await client.query(
          'SELECT * FROM ai_baselines_shared ORDER BY server_name, tool_name'
        );
        return result.rows.map(row => ({
          serverName: row.server_name,
          toolName: row.tool_name,
          sampleCount: row.sample_count,
          avgTokens: row.avg_tokens,
          stddevTokens: row.stddev_tokens,
          avgLatencyMs: row.avg_latency_ms,
          stddevLatencyMs: row.stddev_latency_ms,
          hourlyDistribution: row.hourly_distribution,
          argumentKeys: row.argument_keys,
        }));
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Get baselines failed: ${message}`);
      return [];
    }
  }

  /** Get aggregated metrics across all instances (optional tenant filter via unified tables). */
  async getAggregatedMetrics(tenantId?: string): Promise<{
    totalInstances: number;
    activeInstances: number;
    totalRequests: number;
    totalBlocked: number;
    totalCost: number;
    instances: any[];
  }> {
    try {
      const client = await this.pgPool.connect();
      try {
        const instances = await client.query(
          'SELECT * FROM mastyf_ai_instances WHERE last_heartbeat > NOW() - INTERVAL \'5 minutes\'',
        );

        if (tenantId) {
          const [audit, cost] = await Promise.all([
            client.query(
              `SELECT
                COUNT(DISTINCT instance_id) as total_instances,
                COUNT(*) as total_requests,
                COUNT(*) FILTER (WHERE action = 'block') as total_blocked
               FROM unified_audit_trail
               WHERE timestamp > NOW() - INTERVAL '1 hour' AND tenant_id = $1`,
              [tenantId],
            ),
            client.query(
              `SELECT COALESCE(SUM(cost_usd), 0) as total_cost
               FROM unified_cost_records
               WHERE timestamp > NOW() - INTERVAL '1 hour' AND tenant_id = $1`,
              [tenantId],
            ),
          ]);
          return {
            totalInstances: audit.rows[0]?.total_instances || 0,
            activeInstances: instances.rows.length,
            totalRequests: Number(audit.rows[0]?.total_requests) || 0,
            totalBlocked: Number(audit.rows[0]?.total_blocked) || 0,
            totalCost: Number(cost.rows[0]?.total_cost) || 0,
            instances: instances.rows,
          };
        }

        const metrics = await client.query(
          `SELECT
            COUNT(DISTINCT instance_id) as total_instances,
            SUM(total_requests) as total_requests,
            SUM(blocked_requests) as total_blocked,
            SUM(total_cost_usd) as total_cost
           FROM aggregated_metrics
           WHERE timestamp > NOW() - INTERVAL '1 hour'`,
        );
        return {
          totalInstances: metrics.rows[0]?.total_instances || 0,
          activeInstances: instances.rows.length,
          totalRequests: metrics.rows[0]?.total_requests || 0,
          totalBlocked: metrics.rows[0]?.total_blocked || 0,
          totalCost: metrics.rows[0]?.total_cost || 0,
          instances: instances.rows,
        };
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Get metrics failed: ${message}`);
      return { totalInstances: 0, activeInstances: 0, totalRequests: 0, totalBlocked: 0, totalCost: 0, instances: [] };
    }
  }

  /** Paginated unified cost records for a tenant. */
  async getUnifiedCostRecords(
    tenantId: string,
    opts: { serverName?: string; limit?: number; offset?: number } = {},
  ): Promise<any[]> {
    return this.queryUnifiedTable('unified_cost_records', tenantId, opts);
  }

  /** Paginated unified security scans for a tenant. */
  async getUnifiedSecurityScans(
    tenantId: string,
    opts: { serverName?: string; limit?: number; offset?: number } = {},
  ): Promise<any[]> {
    return this.queryUnifiedTable('unified_security_scans', tenantId, opts);
  }

  /** Paginated unified health checks for a tenant. */
  async getUnifiedHealthChecks(
    tenantId: string,
    opts: { serverName?: string; limit?: number; offset?: number } = {},
  ): Promise<any[]> {
    return this.queryUnifiedTable('unified_health_checks', tenantId, opts);
  }

  private async queryUnifiedTable(
    table: 'unified_cost_records' | 'unified_security_scans' | 'unified_health_checks',
    tenantId: string,
    opts: { serverName?: string; limit?: number; offset?: number },
  ): Promise<any[]> {
    try {
      const { serverName, limit = 50, offset = 0 } = opts;
      const client = await this.pgPool.connect();
      try {
        let query = `SELECT * FROM ${table} WHERE tenant_id = $1`;
        const params: unknown[] = [tenantId];
        let paramIdx = 2;
        if (serverName) {
          query += ` AND server_name = $${paramIdx++}`;
          params.push(serverName);
        }
        query += ` ORDER BY timestamp DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
        params.push(limit, offset);
        const result = await client.query(query, params);
        return result.rows;
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Query ${table} failed: ${message}`);
      return [];
    }
  }

  /** Load shared instant attack learning state (multi-replica). */
  async getAttackLearningState(tenantId = 'default'): Promise<AttackLearningState | null> {
    try {
      const client = await this.pgPool.connect();
      try {
        const result = await client.query(
          'SELECT state_json, updated_at FROM ai_attack_learning_state_shared WHERE tenant_id = $1',
          [tenantId],
        );
        if (result.rows.length === 0) return null;
        return result.rows[0].state_json as AttackLearningState;
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Get attack learning state failed: ${message}`);
      return null;
    }
  }

  /** Persist shared instant attack learning state. */
  async persistAttackLearningState(
    state: AttackLearningState,
    tenantId = 'default',
  ): Promise<void> {
    try {
      const client = await this.pgPool.connect();
      try {
        await client.query(
          `INSERT INTO ai_attack_learning_state_shared (tenant_id, state_json, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (tenant_id) DO UPDATE
           SET state_json = $2, updated_at = NOW()`,
          [tenantId, JSON.stringify(state)],
        );
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Attack learning persist failed: ${message}`);
    }
  }

  /** Get paginated audit trail */
  async getAuditTrail(options: {
    serverName?: string;
    action?: string;
    severity?: string;
    tenantId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    try {
      const { serverName, action, severity, tenantId, limit = 50, offset = 0 } = options;
      const client = await this.pgPool.connect();
      try {
        let query = 'SELECT * FROM unified_audit_trail WHERE 1=1';
        const params: any[] = [];
        let paramIdx = 1;

        if (tenantId) {
          query += ` AND tenant_id = $${paramIdx++}`;
          params.push(tenantId);
        }
        if (serverName) {
          query += ` AND server_name = $${paramIdx++}`;
          params.push(serverName);
        }
        if (action) {
          query += ` AND action = $${paramIdx++}`;
          params.push(action);
        }
        if (severity) {
          query += ` AND severity = $${paramIdx++}`;
          params.push(severity);
        }

        query += ` ORDER BY timestamp DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
        params.push(limit, offset);

        const result = await client.query(query, params);
        return result.rows;
      } finally {
        client.release();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`[AuditTrailSync] Get audit trail failed: ${message}`);
      return [];
    }
  }

  async close(): Promise<void> {
    this.stop();
    await this.pgPool.end();
  }
}