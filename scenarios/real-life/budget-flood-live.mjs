#!/usr/bin/env node
/**
 * Live concurrent budget flood against unified-spend-pool via Redis.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const pool = await import(resolve(ROOT, 'dist/services/unified-spend-pool.js'));

const TENANT = `flood-${Date.now()}`;
const CONCURRENCY = parseInt(process.env.BUDGET_FLOOD_CONCURRENCY || '1000', 10);
const TOKENS_PER_REQ = parseInt(process.env.BUDGET_FLOOD_TOKENS || '10', 10);
const CAP = parseInt(process.env.BUDGET_FLOOD_CAP || '500', 10);
const USD_PER_REQ = parseFloat(process.env.BUDGET_FLOOD_USD || '0');
const USD_MIN_CAP = parseFloat(process.env.BUDGET_FLOOD_USD_MIN_CAP || '0');
const DAY_CAP = parseFloat(process.env.BUDGET_FLOOD_DAY_CAP || '0');

process.env.MASTYF_AI_TENANT_TOKENS_PER_MIN = String(CAP);
if (USD_MIN_CAP > 0) process.env.MASTYF_AI_TENANT_USD_PER_MIN = String(USD_MIN_CAP);
if (DAY_CAP > 0) process.env.MASTYF_AI_DAILY_BUDGET_USD = String(DAY_CAP);

pool.resetUnifiedSpendPoolForTests?.();

const tasks = Array.from({ length: CONCURRENCY }, () =>
  pool.tryReserveSpend({
    tenantId: TENANT,
    sessionKey: 'live-flood',
    tokens: TOKENS_PER_REQ,
    estimatedUsd: USD_PER_REQ,
  }),
);

const results = await Promise.all(tasks);
const allowed = results.filter((r) => r.ok).length;
const denied = results.filter((r) => !r.ok).length;
const maxAllowed = Math.floor(CAP / TOKENS_PER_REQ);
const leakage = Math.max(0, allowed - maxAllowed);

for (const r of results.filter((x) => x.ok && x.reservationId)) {
  await pool.releaseReservedSpend(r.reservationId);
}

const out = {
  tenant: TENANT,
  redis: process.env.REDIS_URL,
  concurrency: CONCURRENCY,
  tokensPerRequest: TOKENS_PER_REQ,
  capTokensPerMin: CAP,
  maxMathematicallyAllowed: maxAllowed,
  allowed,
  denied,
  leakage,
  leakagePct: maxAllowed > 0 ? `${((leakage / maxAllowed) * 100).toFixed(1)}%` : '0%',
  pass: leakage === 0,
};

console.log(JSON.stringify(out, null, 2));
process.exit(out.pass ? 0 : 1);
