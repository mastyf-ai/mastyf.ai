#!/usr/bin/env node
/**
 * Dashboard host for Fleet Hub when no MCP server is configured yet.
 *
 * Normally the first protected server's proxy also serves the dashboard. With nothing to protect
 * there is no such proxy, so Fleet Hub starts this instead: the same dashboard server, the same
 * history database (writable) and a live policy watcher, with no upstream server. Servers added
 * later get their own proxies; they never start a second dashboard.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startDashboardServer, setDashboardDataSource } from '../dist/utils/dashboard-server.js';
import { HistoryDatabase } from '../dist/database/history-db.js';
import { PolicyWatcher } from '../dist/policy/policy-watcher.js';

const port = parseInt(process.env.DASHBOARD_PORT || '4000', 10);
process.env.DASHBOARD_ENABLED = 'true';

const policyPath = resolve(process.env.MASTYF_AI_POLICY_PATH || 'default-policy.yaml');
let watcher;
if (existsSync(policyPath)) {
  process.env.MASTYF_AI_POLICY_PATH = policyPath;
  watcher = new PolicyWatcher(policyPath);
}

setDashboardDataSource(new HistoryDatabase(process.env.MASTYF_AI_DB_PATH || undefined));
await startDashboardServer(port, watcher);
console.log(`[fleet-dashboard] Dashboard on http://localhost:${port}/ (no MCP servers protected yet)`);

const quit = () => process.exit(0);
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
