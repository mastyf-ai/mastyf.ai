import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | null = null;
let dbInstance: Db | null = null;

/** True when DATABASE_URL is configured for the cloud control plane. */
export function cloudDbAvailable(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb(): Db {
  if (dbInstance) return dbInstance;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the cloud control plane');
  }
  client = postgres(connectionString, { max: 10 });
  dbInstance = drizzle(client, { schema });
  return dbInstance;
}
