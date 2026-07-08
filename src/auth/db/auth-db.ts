/**
 * Thin dual-backend database adapter for the auth/RBAC subsystem.
 *
 * mastyf.ai already supports two storage backends selected via DB_TYPE
 * (see src/database/create-database.ts): `sqlite` (default, better-sqlite3)
 * and `postgres` (via `pg`). The auth subsystem follows the same switch so
 * it works out of the box in both local/community and production/HA
 * deployments without requiring a separate database.
 *
 * All call sites write SQL using `?` placeholders (SQLite style) and this
 * adapter rewrites them to `$1, $2, ...` for Postgres. Only a small,
 * hand-rolled subset of SQL is used (simple SELECT/INSERT/UPDATE/DELETE),
 * so this is safe and avoids pulling in a full query builder dependency.
 */
import { randomUUID } from 'crypto';
import { resolveMastyfAiDbPath } from '../../utils/mastyf-ai-db-path.js';
import { Logger } from '../../utils/logger.js';
import { SQLITE_AUTH_SCHEMA_SQL } from './auth-schema.sqlite.js';

export type AuthDbRow = Record<string, unknown>;

export interface AuthDbAdapter {
  readonly dialect: 'sqlite' | 'postgres';
  init(): Promise<void>;
  get(sql: string, params?: unknown[]): Promise<AuthDbRow | undefined>;
  all(sql: string, params?: unknown[]): Promise<AuthDbRow[]>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  newId(): string;
  /** ISO-8601 timestamp for "now", used consistently across both backends. */
  nowIso(): string;
}

function rewriteForPostgres(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

class SqliteAuthDb implements AuthDbAdapter {
  readonly dialect = 'sqlite' as const;
  private db: import('better-sqlite3').Database | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    const Database = (await import('better-sqlite3')).default;
    const dbPath = resolveMastyfAiDbPath(undefined);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SQLITE_AUTH_SCHEMA_SQL);
    Logger.info('[auth-db] SQLite auth schema ready');
  }

  private handle() {
    if (!this.db) throw new Error('AuthDb not initialized — call init() first');
    return this.db;
  }

  async get(sql: string, params: unknown[] = []): Promise<AuthDbRow | undefined> {
    return this.handle().prepare(sql).get(...params) as AuthDbRow | undefined;
  }

  async all(sql: string, params: unknown[] = []): Promise<AuthDbRow[]> {
    return this.handle().prepare(sql).all(...params) as AuthDbRow[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const info = this.handle().prepare(sql).run(...params);
    return { changes: info.changes };
  }

  newId(): string {
    return randomUUID();
  }

  nowIso(): string {
    return new Date().toISOString();
  }
}

class PostgresAuthDb implements AuthDbAdapter {
  readonly dialect = 'postgres' as const;
  private pool: import('pg').Pool | null = null;

  async init(): Promise<void> {
    if (this.pool) return;
    const { Pool } = await import('pg');
    const connectionString = process.env['DATABASE_URL'] || 'postgresql://localhost:5432/mastyf_ai';
    this.pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30000 });
    // Migration 020-auth-rbac.sql creates the schema via the existing
    // migration-runner (see src/database/postgres-db.ts initialize()).
    // We also defensively verify the table exists here so the process
    // fails fast with a clear error instead of surfacing confusing SQL
    // errors on first login attempt.
    try {
      await this.pool.query('SELECT 1 FROM auth_users LIMIT 1');
    } catch (err) {
      Logger.error(
        `[auth-db] auth_users table not found — run migrations before starting the server: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
    Logger.info('[auth-db] PostgreSQL auth schema verified');
  }

  private handle() {
    if (!this.pool) throw new Error('AuthDb not initialized — call init() first');
    return this.pool;
  }

  async get(sql: string, params: unknown[] = []): Promise<AuthDbRow | undefined> {
    const result = await this.handle().query(rewriteForPostgres(sql), params);
    return result.rows[0] as AuthDbRow | undefined;
  }

  async all(sql: string, params: unknown[] = []): Promise<AuthDbRow[]> {
    const result = await this.handle().query(rewriteForPostgres(sql), params);
    return result.rows as AuthDbRow[];
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = await this.handle().query(rewriteForPostgres(sql), params);
    return { changes: result.rowCount ?? 0 };
  }

  newId(): string {
    return randomUUID();
  }

  nowIso(): string {
    return new Date().toISOString();
  }
}

let singleton: AuthDbAdapter | null = null;

/** Get (and lazily initialize) the process-wide auth DB adapter. */
export async function getAuthDb(): Promise<AuthDbAdapter> {
  if (singleton) return singleton;
  const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();
  const adapter: AuthDbAdapter = dbType === 'postgres' ? new PostgresAuthDb() : new SqliteAuthDb();
  await adapter.init();
  singleton = adapter;
  return singleton;
}

/** Test-only hook to reset the singleton between test suites. */
export function __resetAuthDbForTests(): void {
  singleton = null;
}
