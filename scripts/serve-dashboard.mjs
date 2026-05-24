#!/usr/bin/env node
/**
 * Standalone dashboard HTTP server (port 4000 by default).
 * Automatically loads the proxy history database if available.
 */
import { startDashboardServer, setDashboardDataSource } from '../dist/utils/dashboard-server.js';
import { resolveGuardianDbPath } from '../dist/utils/guardian-db-path.js';
import { HistoryDatabase } from '../dist/database/history-db.js';
import { existsSync } from 'node:fs';

const port = parseInt(process.env.DASHBOARD_PORT || '4000', 10);
process.env.DASHBOARD_ENABLED = 'true';
process.env.GUARDIAN_WS_ENABLED = process.env.GUARDIAN_WS_ENABLED ?? 'true';

// Open the proxy history database if it exists
const dbPath = process.env.MCP_GUARDIAN_DB_PATH || resolveGuardianDbPath();
if (existsSync(dbPath)) {
  try {
    const historyDb = new HistoryDatabase(dbPath, { readOnly: true });
    setDashboardDataSource(historyDb);
    console.log(`[serve-dashboard] Loaded history database: ${dbPath}`);
  } catch (err) {
    console.error(`[serve-dashboard] Failed to open history database: ${err.message}`);
  }
} else {
  console.log(`[serve-dashboard] No history database at ${dbPath} — dashboard will start without proxy data`);
  console.log(`[serve-dashboard] Run the proxy or set MCP_GUARDIAN_DB_PATH to show live traffic`);
}

await startDashboardServer(port);
console.log(`[serve-dashboard] http://localhost:${port}/ (Ctrl+C to stop)`);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
