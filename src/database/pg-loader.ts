import type { Pool as PgPool } from 'pg';

let pgModule: typeof import('pg') | null = null;

/** Load optional `pg` dependency (install with `pnpm add pg` when using PostgreSQL). */
export async function loadPg(): Promise<typeof import('pg')> {
  if (!pgModule) {
    try {
      pgModule = await import('pg');
    } catch {
      throw new Error(
        'PostgreSQL support requires the optional `pg` package. Install it (`pnpm add pg`) and set DB_TYPE=postgres with DATABASE_URL.',
      );
    }
  }
  return pgModule;
}

export type PgPoolType = PgPool;
