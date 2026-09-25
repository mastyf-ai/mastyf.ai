/**
 * Log Shipper — Pino transport that ships structured JSON logs to
 * PostgreSQL mastyf_ai_logs table for centralized log aggregation.
 *
 * Integrates with existing pino logger in src/utils/structured-logger.ts
 * to provide real-time log shipping alongside stdout/file outputs.
 */
import { loadPg } from '../database/pg-loader.js';
import { Logger } from '../utils/logger.js';
const LEVEL_NAMES = {
    10: 'trace',
    20: 'debug',
    30: 'info',
    40: 'warn',
    50: 'error',
    60: 'fatal',
};
const DEFAULT_CONFIG = {
    instanceId: process.env['MASTYF_AI_INSTANCE_ID'] || `mastyf-ai-${process.pid}`,
    databaseUrl: process.env['DATABASE_URL'] || 'postgresql://localhost:5432/mastyf_ai',
    minLevel: parseInt(process.env['MASTYF_AI_LOG_SHIP_LEVEL'] || '30', 10),
    batchSize: parseInt(process.env['MASTYF_AI_LOG_BATCH_SIZE'] || '50', 10),
    flushIntervalMs: parseInt(process.env['MASTYF_AI_LOG_FLUSH_MS'] || '5000', 10),
    enabled: process.env['MASTYF_AI_LOG_SHIP_ENABLED'] !== 'false',
};
export class LogShipper {
    pgPool;
    poolReady = null;
    config;
    buffer = [];
    flushTimer = null;
    shuttingDown = false;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    async ensurePool() {
        if (!this.poolReady) {
            this.poolReady = (async () => {
                const { Pool } = await loadPg();
                this.pgPool = new Pool({
                    connectionString: this.config.databaseUrl,
                    max: 3,
                    idleTimeoutMillis: 30000,
                });
            })();
        }
        await this.poolReady;
        return this.pgPool;
    }
    /** Start the log shipper */
    async start() {
        if (!this.config.enabled) {
            Logger.info('[LogShipper] Disabled — set MASTYF_AI_LOG_SHIP_ENABLED=true to enable');
            return;
        }
        await this.ensurePool();
        Logger.info(`[LogShipper] Started — shipping logs >= ${LEVEL_NAMES[this.config.minLevel] || this.config.minLevel} to PG`);
        this.flushTimer = setInterval(() => {
            this.flush().catch(err => {
                Logger.error(`[LogShipper] Flush failed: ${err instanceof Error ? err.message : String(err)}`);
            });
        }, this.config.flushIntervalMs);
    }
    /** Stop the log shipper gracefully */
    async stop() {
        this.shuttingDown = true;
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        // Final flush
        await this.flush();
        if (this.poolReady) {
            const pool = await this.ensurePool();
            await pool.end();
        }
    }
    /**
     * Write a log entry to the buffer. This is the main method called
     * by the pino transport or log hooks.
     */
    write(entry) {
        if (!this.config.enabled)
            return;
        if (entry.level < this.config.minLevel)
            return;
        this.buffer.push(entry);
        // Auto-flush if buffer exceeds batch size
        if (this.buffer.length >= this.config.batchSize) {
            // Fire-and-forget flush (don't block the log call)
            this.flush().catch(err => {
                Logger.error(`[LogShipper] Auto-flush failed: ${err instanceof Error ? err.message : String(err)}`);
            });
        }
    }
    /**
     * Write a log entry synchronously (for pino stream compatibility).
     * Returns immediately — the log is buffered, not written synchronously.
     */
    writeSync(entry) {
        if (!this.config.enabled)
            return;
        try {
            const parsed = JSON.parse(entry);
            this.write(parsed);
        }
        catch {
            // If we can't parse, ship as a raw message
            this.write({
                level: 30,
                time: Date.now(),
                pid: process.pid,
                hostname: process.env['HOSTNAME'] || 'unknown',
                msg: entry,
            });
        }
    }
    /** Flush buffered logs to PostgreSQL */
    async flush() {
        if (this.buffer.length === 0)
            return;
        // Take a shallow copy — only remove from buffer after successful commit
        const batch = this.buffer.slice(0, this.buffer.length);
        const batchSize = batch.length;
        if (batchSize === 0)
            return;
        const pool = await this.ensurePool();
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Build multi-value INSERT for efficiency
            const placeholders = [];
            const values = [];
            let paramIdx = 1;
            for (const entry of batch) {
                const levelName = LEVEL_NAMES[entry.level] || 'info';
                const errorMsg = entry.err?.message || null;
                const errorStack = entry.err?.stack || null;
                const module = entry.module || null;
                const serverName = entry.serverName || null;
                const toolName = entry.toolName || null;
                const requestId = entry.requestId || null;
                // Extract any extra metadata not in standard fields
                const standardKeys = new Set([
                    'level', 'time', 'pid', 'hostname', 'msg', 'module',
                    'serverName', 'toolName', 'requestId', 'err',
                ]);
                const metadata = {};
                for (const [key, value] of Object.entries(entry)) {
                    if (!standardKeys.has(key) && value !== undefined) {
                        metadata[key] = value;
                    }
                }
                placeholders.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
                values.push(this.config.instanceId, new Date(entry.time || Date.now()).toISOString(), entry.level, levelName, entry.msg, module, serverName, toolName, requestId, errorMsg, errorStack, JSON.stringify(metadata));
            }
            await client.query(`INSERT INTO mastyf_ai_logs
         (instance_id, timestamp, level, level_name, message, module,
          server_name, tool_name, request_id, error, stack, metadata)
         VALUES ${placeholders.join(', ')}`, values);
            await client.query('COMMIT');
            // Only remove successfully shipped entries from buffer
            this.buffer.splice(0, batchSize);
            Logger.debug(`[LogShipper] Shipped ${batchSize} logs`);
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
    }
    /**
     * Create a pino transport stream object for use with pino's multistream.
     * Usage: pino({}, pino.multistream([...existingStreams, logShipper.createPinoStream()]))
     */
    createPinoStream() {
        return {
            write: (chunk) => this.writeSync(chunk),
        };
    }
    /** Query recent logs from PG */
    async queryLogs(options = {}) {
        try {
            const { instanceId, level, serverName, limit = 100, offset = 0 } = options;
            const pool = await this.ensurePool();
            const client = await pool.connect();
            try {
                let query = 'SELECT * FROM mastyf_ai_logs WHERE 1=1';
                const params = [];
                let paramIdx = 1;
                if (instanceId) {
                    query += ` AND instance_id = $${paramIdx++}`;
                    params.push(instanceId);
                }
                if (level !== undefined) {
                    query += ` AND level >= $${paramIdx++}`;
                    params.push(level);
                }
                if (serverName) {
                    query += ` AND server_name = $${paramIdx++}`;
                    params.push(serverName);
                }
                query += ` ORDER BY timestamp DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
                params.push(limit, offset);
                const result = await client.query(query, params);
                return result.rows;
            }
            finally {
                client.release();
            }
        }
        catch (err) {
            Logger.warn(`[LogShipper] Query logs failed: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    /** Get log count by level for dashboard stats */
    async getLogStats(hoursBack = 24) {
        try {
            const pool = await this.ensurePool();
            const client = await pool.connect();
            try {
                const [levelResult, serverResult, totalResult] = await Promise.all([
                    client.query(`SELECT level_name, COUNT(*) as count FROM mastyf_ai_logs
             WHERE timestamp > NOW() - INTERVAL '1 hour' * $1
             GROUP BY level_name ORDER BY count DESC`, [hoursBack]),
                    client.query(`SELECT server_name, COUNT(*) as count FROM mastyf_ai_logs
             WHERE timestamp > NOW() - INTERVAL '1 hour' * $1
             AND server_name IS NOT NULL
             GROUP BY server_name ORDER BY count DESC LIMIT 20`, [hoursBack]),
                    client.query(`SELECT COUNT(*) as total FROM mastyf_ai_logs
             WHERE timestamp > NOW() - INTERVAL '1 hour' * $1`, [hoursBack]),
                ]);
                const byLevel = {};
                for (const row of levelResult.rows) {
                    byLevel[row.level_name] = parseInt(row.count, 10);
                }
                const byServer = {};
                for (const row of serverResult.rows) {
                    byServer[row.server_name] = parseInt(row.count, 10);
                }
                return {
                    total: parseInt(totalResult.rows[0]?.total || '0', 10),
                    byLevel,
                    byServer,
                };
            }
            finally {
                client.release();
            }
        }
        catch (err) {
            Logger.warn(`[LogShipper] Log stats failed: ${err instanceof Error ? err.message : String(err)}`);
            return { total: 0, byLevel: {}, byServer: {} };
        }
    }
}
//# sourceMappingURL=log-shipper.js.map