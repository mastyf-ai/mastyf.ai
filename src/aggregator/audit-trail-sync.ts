/**
 * Audit Trail Sync — periodically syncs per-instance SQLite history
 * databases to the central PostgreSQL unified_audit_trail table.
 *
 * This ensures all policy decisions, call records, security scans,
 * cost records, and health checks are aggregated in one place.
 */
import { HistoryDatabase } from '../database/history-db.js';
import { Pool } from 'pg';
import { Logger } from '../utils/logger.js';
import { ProxyCallRecord } from '../types.js';

export interface SyncConfig {
  instanceId: string;
  instanceName: string;
  syncIntervalMs: number;
  batchSize: number;
  databaseUrl: string;
}

const DEFAULT_CONFIG: SyncConfig = {
  instanceId: process.env['GUARDIAN_INSTANCE_ID'] || `guardian-${process.pid}-${Date.now()}`,
  instanceName: process.env['GUARDIAN_INSTANCE_NAME'] || process.env['HOSTNAME'] || 'unknown',
  syncIntervalMs: parseInt(process.env['GUARDIAN_SYNC_INTERVAL_MS'] || '30000', 10),
  batchSize: parseInt(process.env['GUARDIAN_SYNC_BATCH_SIZE'] || '100', 10),
  databaseUrl: process.env['DATABASE_URL'] || 'postgresql://localhost:5432/mcp_guardian',
};

export class AuditTrailSync {
  private localDb: HistoryDatabase;
  private pgPool: Pool;
  private config: SyncConfig;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(localDb: HistoryDatabase, config?: Partial<SyncConfig>) {
    this.localDb = localDb;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pgPool = new Pool({
      connectionString: this.config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }

  async initialize(): Promise<void> {
    const client = await this.pgPool.connect();
    try {
      // Run migration
      const { readFileSync } = await import('fs');
      const { resolve, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const sqlPath = resolve(__dirname, '..', 'database', 'migrations', '002-unified-aggregation.sql');
      const migrationSql = readFileSync(sqlPath, 'utf-8');
      await client.query(migrationSql);

      // Register this instance
      await client.query(
        `INSERT INTO guardian_instances (instance_id, instance_name, hostname, version, started_at, last_heartbeat, status)
         VALUES ($1, $2, $3, $4, NOW(), NOW(), 'active')
         ON CONFLICT (instance_id) DO UPDATE
         SET last_heartbeat = NOW(), status = 'active', hostname = $3, version = $4`,
        [
          this.config.instanceId,
          this.config.instanceName,
          process.env['HOSTNAME'] || 'unknown',
          process.env.npm_package_version || '2.3.24',
        ]
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
      const servers = await this.localDb.getDistinctScannedServers();
      for (const serverName of servers) {
        const records = await this.localDb.getCallRecordsForServer(serverName);
        if (records.length === 0) continue;

        const client = await this.pgPool.connect();
        try {
          await client.query('BEGIN');
          for (const record of records) {
            // ProxyCallRecord lacks action/severity fields — call records are
            // informational and default to 'pass'/'info'; policy decisions use
            // recordPolicyDecision() which stores real action/severity values.
            await client.query(
              `INSERT INTO unified_audit_trail
               (instance_id, server_name, tool_name, action, request_tokens, response_tokens, total_tokens, duration_ms, severity)
               VALUES ($1, $2, $3, 'pass', $4, $5, $6, $7, 'info')
               ON CONFLICT (id) DO NOTHING`,
              [
                this.config.instanceId,
                record.serverName,
                record.toolName,
                record.requestTokens,
                record.responseTokens,
                record.totalTokens,
                record.durationMs,
              ]
            );
          }
          await client.query('COMMIT');
          if (records.length > 0) {
            Logger.debug(`[AuditTrailSync] Synced ${records.length} call records for ${serverName}`);
          }
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Call record sync error: ${err?.message}`);
    }
  }

  /** Sync security scans to unified_security_scans */
  private async syncSecurityScans(): Promise<void> {
    try {
      const servers = await this.localDb.getDistinctScannedServers();
      for (const serverName of servers) {
        const scan = await this.localDb.getLatestSecurityScan(serverName);
        if (!scan) continue;

        const s = scan as any;
        const client = await this.pgPool.connect();
        try {
          await client.query(
            `INSERT INTO unified_security_scans
             (instance_id, server_name, score, cve_count, details)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [
              this.config.instanceId,
              serverName,
              s.score || 0,
              s.cve_count || 0,
              JSON.stringify(s.details || {}),
            ]
          );
        } finally {
          client.release();
        }
      }
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Security scan sync error: ${err?.message}`);
    }
  }

  /** Sync cost records to unified_cost_records */
  private async syncCostRecords(): Promise<void> {
    try {
      // Cost records are stored in the cost_records table via addCostRecord
      // The HistoryDatabase doesn't expose a direct query for cost records,
      // so we track them through the unified audit trail which captures token usage
      const servers = await this.localDb.getDistinctScannedServers();
      for (const serverName of servers) {
        const records = await this.localDb.getCallRecordsForServer(serverName);
        if (records.length === 0) continue;

        // Aggregate cost data per server from call records
        const totalTokens = records.reduce((s, r) => s + r.totalTokens, 0);
        const inputTokens = records.reduce((s, r) => s + r.requestTokens, 0);
        const outputTokens = records.reduce((s, r) => s + r.responseTokens, 0);

        const client = await this.pgPool.connect();
        try {
          await client.query(
            `INSERT INTO unified_cost_records
             (instance_id, server_name, tokens_used, input_tokens, output_tokens, cost_usd)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [
              this.config.instanceId,
              serverName,
              totalTokens,
              inputTokens,
              outputTokens,
              0, // Cost computed by central cost auditor via PricingClient
            ]
          );
        } finally {
          client.release();
        }
      }
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Cost record sync error: ${err?.message}`);
    }
  }

  /** Sync health checks to unified_health_checks */
  private async syncHealthChecks(): Promise<void> {
    try {
      const servers = await this.localDb.getDistinctScannedServers();
      for (const serverName of servers) {
        const successRate = await this.localDb.getRecentSuccessRate(serverName);
        if (successRate === null) continue;

        const client = await this.pgPool.connect();
        try {
          // latency_ms and tool_count are placeholders (0) — HistoryDatabase
          // doesn't currently persist latency/tool-count per server; these
          // fields are populated when real metrics become available.
          await client.query(
            `INSERT INTO unified_health_checks
             (instance_id, server_name, latency_ms, success, success_rate, tool_count)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [
              this.config.instanceId,
              serverName,
              0, // latency_ms: placeholder (no per-server latency data available)
              successRate > 0.5,
              successRate,
              0, // tool_count: placeholder (no per-server tool count available)
            ]
          );
        } finally {
          client.release();
        }
      }
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Health check sync error: ${err?.message}`);
    }
  }

  /** Send heartbeat to keep instance status active */
  private async sendHeartbeat(): Promise<void> {
    try {
      const client = await this.pgPool.connect();
      try {
        await client.query(
          'UPDATE guardian_instances SET last_heartbeat = NOW(), status = $2 WHERE instance_id = $1',
          [this.config.instanceId, 'active']
        );
      } finally {
        client.release();
      }
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Heartbeat failed: ${err?.message}`);
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
  }): Promise<void> {
    try {
      const client = await this.pgPool.connect();
      try {
        await client.query(
          `INSERT INTO unified_audit_trail
           (instance_id, server_name, tool_name, action, rule_name, reason,
            request_tokens, response_tokens, total_tokens, duration_ms,
            estimated_cost_usd, model, client_ip, auth_success, severity, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
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
          ]
        );
      } finally {
        client.release();
      }
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Decision record failed: ${err?.message}`);
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
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Learning outcome failed: ${err?.message}`);
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
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Baseline persist failed: ${err?.message}`);
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
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Get baselines failed: ${err?.message}`);
      return [];
    }
  }

  /** Get aggregated metrics across all instances */
  async getAggregatedMetrics(): Promise<{
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
        const [instances, metrics] = await Promise.all([
          client.query('SELECT * FROM guardian_instances WHERE last_heartbeat > NOW() - INTERVAL \'5 minutes\''),
          client.query(
            `SELECT
              COUNT(DISTINCT instance_id) as total_instances,
              SUM(total_requests) as total_requests,
              SUM(blocked_requests) as total_blocked,
              SUM(total_cost_usd) as total_cost
             FROM aggregated_metrics
             WHERE timestamp > NOW() - INTERVAL '1 hour'`
          ),
        ]);
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
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Get metrics failed: ${err?.message}`);
      return { totalInstances: 0, activeInstances: 0, totalRequests: 0, totalBlocked: 0, totalCost: 0, instances: [] };
    }
  }

  /** Get paginated audit trail */
  async getAuditTrail(options: {
    serverName?: string;
    action?: string;
    severity?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    try {
      const { serverName, action, severity, limit = 50, offset = 0 } = options;
      const client = await this.pgPool.connect();
      try {
        let query = 'SELECT * FROM unified_audit_trail WHERE 1=1';
        const params: any[] = [];
        let paramIdx = 1;

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
    } catch (err: any) {
      Logger.warn(`[AuditTrailSync] Get audit trail failed: ${err?.message}`);
      return [];
    }
  }

  async close(): Promise<void> {
    this.stop();
    await this.pgPool.end();
  }
}