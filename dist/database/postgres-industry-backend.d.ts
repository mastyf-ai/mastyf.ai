/**
 * PostgreSQL implementation of `IndustryHotBackend`.
 *
 * Only the five tables the synchronous enforcement path reads. The DDL mirrors
 * src/database/migrations/012-industry-standard.sql and 013-roadmap-phase1.sql,
 * with two deliberate differences:
 *   - `datetime('now')` is SQLite-only; PostgreSQL needs `now()::text`.
 *   - No `AUTOINCREMENT` (SQLite); the hot tables are all keyed by text, so
 *     there is no serial column to translate.
 *
 * Columns are TEXT rather than TIMESTAMPTZ on purpose: the SQLite schema stores
 * ISO-8601 strings and IndustryStandardStore compares and returns them as
 * strings. Keeping the same types means the sync getters can serve a Postgres
 * row without any date parsing change.
 */
import type { IndustryHotBackend, IndustryHotSnapshot, HotRow, HotTable } from './industry-hot-state.js';
type QueryFn = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
export declare class PostgresIndustryHotBackend implements IndustryHotBackend {
    private readonly query;
    readonly dialect: "postgres";
    constructor(query: QueryFn);
    ensureSchema(): Promise<void>;
    loadAll(tenantId: string): Promise<IndustryHotSnapshot>;
    upsert(table: HotTable, row: HotRow): Promise<void>;
}
/**
 * Build the backend from an initialized `PostgresDatabase`.
 *
 * Kept separate from the store so the pool, migrations, and this DDL all stay
 * in the database layer and the policy layer never sees SQL.
 */
export declare function createPostgresIndustryHotBackend(db: {
    exec: QueryFn;
}): PostgresIndustryHotBackend;
export {};
//# sourceMappingURL=postgres-industry-backend.d.ts.map