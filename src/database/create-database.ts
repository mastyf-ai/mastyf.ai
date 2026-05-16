import { HistoryDatabase } from './history-db.js';
import { IDatabase } from './database-interface.js';
import { Logger } from '../utils/logger.js';
import { resolveGuardianDbPath } from '../utils/guardian-db-path.js';

export async function createDatabase(dbPath?: string): Promise<IDatabase> {
  const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();

  if (dbType === 'postgres') {
    const { PostgresDatabase } = await import('./postgres-db.js');
    const pg = new PostgresDatabase();
    await pg.initialize();
    Logger.info('[database] Using PostgreSQL backend');
    return pg;
  }

  const effectivePath = resolveGuardianDbPath(dbPath);
  const sqlite = new HistoryDatabase(effectivePath);
  Logger.info(`[database] Using SQLite backend at ${effectivePath}`);
  return sqlite;
}

export function createDatabaseSync(dbPath?: string): HistoryDatabase {
  const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();
  if (dbType === 'postgres') {
    Logger.warn('[database] DB_TYPE=postgres requires createDatabase() — falling back to SQLite for sync init');
  }
  return new HistoryDatabase(resolveGuardianDbPath(dbPath));
}
