/**
 * Postgres row-level security session helper (§6.1 Issue #4).
 * Requires migration 006/008 and MASTYF_AI_PG_RLS_ENABLED=true.
 */
import type { PgPoolType } from './pg-loader.js';
export declare function isPostgresRlsEnabled(): boolean;
export declare function withPostgresTenantSession<T>(pool: PgPoolType, tenantId: string, fn: (client: {
    query: (sql: string, params?: unknown[]) => Promise<{
        rows: unknown[];
    }>;
}) => Promise<T>): Promise<T>;
//# sourceMappingURL=postgres-tenant-session.d.ts.map