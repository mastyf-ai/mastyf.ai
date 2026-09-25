import type { Pool as PgPool } from 'pg';
/** Load optional `pg` dependency (install with `pnpm add pg` when using PostgreSQL). */
export declare function loadPg(): Promise<typeof import('pg')>;
export type PgPoolType = PgPool;
//# sourceMappingURL=pg-loader.d.ts.map