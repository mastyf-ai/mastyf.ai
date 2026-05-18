import { describe, it, expect, vi } from 'vitest';
import { runMigrations } from '../../src/database/migration-runner.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('runMigrations', () => {
  it('applies pending SQL files and records schema_migrations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-test-'));
    writeFileSync(join(dir, '001-init.sql'), 'CREATE TABLE IF NOT EXISTS t1 (id INT);');
    writeFileSync(join(dir, '002-more.sql'), 'CREATE TABLE IF NOT EXISTS t2 (id INT);');

    const queries: string[] = [];
    const pool = {
      connect: async () => ({
        query: async (sql: string, params?: unknown[]) => {
          queries.push(sql);
          if (sql.includes('SELECT 1 FROM schema_migrations')) {
            return { rows: [] };
          }
          return { rows: [], rowCount: 0 };
        },
        release: () => {},
      }),
    };

    const applied = await runMigrations(pool as any, dir);
    expect(applied).toEqual(['001-init', '002-more']);
    expect(queries.some((q) => q.includes('INSERT INTO schema_migrations'))).toBe(true);
  });

  it('skips already applied migrations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-skip-'));
    writeFileSync(join(dir, '001-init.sql'), 'SELECT 1;');

    const pool = {
      connect: async () => ({
        query: async (sql: string) => {
          if (sql.includes('SELECT 1 FROM schema_migrations')) {
            return { rows: [{ '?column?': 1 }] };
          }
          return { rows: [] };
        },
        release: () => {},
      }),
    };

    const applied = await runMigrations(pool as any, dir);
    expect(applied).toEqual([]);
  });
});
