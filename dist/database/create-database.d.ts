import { HistoryDatabase } from './history-db.js';
import { IDatabase } from './database-interface.js';
export declare function createDatabase(dbPath?: string): Promise<IDatabase>;
export declare function createDatabaseSync(dbPath?: string): HistoryDatabase;
//# sourceMappingURL=create-database.d.ts.map