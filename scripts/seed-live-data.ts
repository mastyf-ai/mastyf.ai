/** Import a real HistoryDatabase call-record export into the local live store. */
import { HistoryDatabase } from '../src/database/history-db.js';
import { readFileSync } from 'fs';

const importPath = process.env.MASTYF_AI_IMPORT_HISTORY_JSON?.trim();
if (!importPath) {
  console.error('Refusing to write live data without MASTYF_AI_IMPORT_HISTORY_JSON pointing to a real exported call-record JSON file.');
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(importPath, 'utf8')) as unknown;
if (!Array.isArray(parsed)) {
  console.error('MASTYF_AI_IMPORT_HISTORY_JSON must contain an array of real proxy call records.');
  process.exit(1);
}

const db = new HistoryDatabase();
await db.initialize?.();

let imported = 0;
for (const item of parsed as Array<Record<string, unknown>>) {
  const serverName = String(item.serverName || item.server_name || '').trim();
  const toolName = String(item.toolName || item.tool_name || '').trim();
  const timestamp = String(item.timestamp || '').trim();
  if (!serverName || !toolName || !timestamp) continue;
  await db.addCallRecord({
    serverName,
    toolName,
    requestTokens: Number(item.requestTokens ?? item.request_tokens ?? 0),
    responseTokens: Number(item.responseTokens ?? item.response_tokens ?? 0),
    totalTokens: Number(item.totalTokens ?? item.total_tokens ?? 0),
    durationMs: Number(item.durationMs ?? item.duration_ms ?? 0),
    timestamp,
    model: typeof item.model === 'string' ? item.model : undefined,
    costUsd: typeof item.costUsd === 'number' ? item.costUsd : null,
    pricingSource: item.pricingSource as never,
    blocked: item.blocked === true,
    blockRule: typeof item.blockRule === 'string' ? item.blockRule : undefined,
    blockReason: typeof item.blockReason === 'string' ? item.blockReason : undefined,
    tenantId: typeof item.tenantId === 'string' ? item.tenantId : undefined,
  });
  imported++;
}

db.close();
console.log(`Imported ${imported} real call records.`);