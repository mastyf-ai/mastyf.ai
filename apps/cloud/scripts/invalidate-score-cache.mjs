#!/usr/bin/env node
/**
 * Invalidate all cached scores so packages get re-scored with the updated
 * scoring logic on next lookup. Sets expires_at to now so the next request
 * triggers a fresh computation.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env.local') });

async function main() {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const res = await client.query(`
    UPDATE package_score_cache
    SET expires_at = NOW() - INTERVAL '1 second'
    WHERE expires_at > NOW()
  `);

  console.log(`Invalidated ${res.rowCount} cached scores. They will be re-scored on next lookup.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
