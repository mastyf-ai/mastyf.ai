import { HistoryDatabase } from './history-db.js';
import { Logger } from '../utils/logger.js';
import { resolveMastyfAiDbPath } from '../utils/mastyf-ai-db-path.js';
export async function createDatabase(dbPath) {
    const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();
    if (dbType === 'postgres') {
        const { PostgresDatabase } = await import('./postgres-db.js');
        const pg = new PostgresDatabase();
        await pg.initialize();
        Logger.info('[database] Using PostgreSQL backend');
        return pg;
    }
    const effectivePath = resolveMastyfAiDbPath(dbPath);
    const sqlite = new HistoryDatabase(effectivePath);
    Logger.info(`[database] Using SQLite backend at ${effectivePath}`);
    return sqlite;
}
export function createDatabaseSync(dbPath) {
    const dbType = (process.env['DB_TYPE'] || 'sqlite').toLowerCase();
    if (dbType === 'postgres') {
        Logger.warn('[database] DB_TYPE=postgres requires createDatabase() — falling back to SQLite for sync init');
    }
    return new HistoryDatabase(resolveMastyfAiDbPath(dbPath));
}
//# sourceMappingURL=create-database.js.map