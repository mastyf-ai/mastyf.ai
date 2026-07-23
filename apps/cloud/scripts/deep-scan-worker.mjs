#!/usr/bin/env node
/**
 * Long-running deep-scan worker — polls deep_scan_jobs and runs live MCP scoring.
 * Requires DATABASE_URL and built workspace packages (pnpm run build).
 */
import postgres from 'postgres';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');
const pollMs = parseInt(process.env.MASTYF_AI_DEEP_SCAN_WORKER_POLL_MS || '3000', 10);
const LIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[deep-scan-worker] DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { max: 2 });

async function loadScorer() {
  try {
    return require(join(repoRoot, 'packages/server/dist/package-scorer.js'));
  } catch {
    return require('@mastyf_ai/mcp-server/package-scorer');
  }
}

async function writeCache(scored) {
  const expiresAt = new Date(Date.now() + LIVE_TTL_MS).toISOString();
  await sql`
    INSERT INTO package_score_cache (
      package_name, version, scan_tier, score, level, grade,
      score_report, checks, computed_at, expires_at
    ) VALUES (
      ${scored.packageName},
      ${scored.version},
      ${scored.scanTier},
      ${scored.score},
      ${scored.level},
      ${scored.grade},
      ${JSON.stringify(scored.scoreReport)}::jsonb,
      ${JSON.stringify(scored.checks)}::jsonb,
      ${scored.computedAt}::timestamptz,
      ${expiresAt}::timestamptz
    )
    ON CONFLICT (package_name, version, scan_tier) DO UPDATE SET
      score = EXCLUDED.score,
      level = EXCLUDED.level,
      grade = EXCLUDED.grade,
      score_report = EXCLUDED.score_report,
      checks = EXCLUDED.checks,
      computed_at = EXCLUDED.computed_at,
      expires_at = EXCLUDED.expires_at
  `;
}

async function claimNext() {
  const rows = await sql`
    UPDATE deep_scan_jobs
    SET status = 'running', started_at = NOW(), updated_at = NOW()
    WHERE id = (
      SELECT id FROM deep_scan_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, package_name
  `;
  return rows[0] ?? null;
}

async function completeJob(id, payload) {
  if (payload.ok) {
    await sql`
      UPDATE deep_scan_jobs
      SET status = 'done',
          result_json = ${JSON.stringify(payload.result)}::jsonb,
          error = NULL,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id}
    `;
    return;
  }
  await sql`
    UPDATE deep_scan_jobs
    SET status = 'failed',
        error = ${payload.error},
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${id}
  `;
}

async function runJob(row, scorer) {
  const packageName = String(row.package_name);
  console.log(`[deep-scan-worker] scanning ${packageName} (${row.id})`);
  try {
    if (!scorer.isValidNpmPackageName(packageName)) {
      throw new Error('invalid_package_name');
    }
    const scored = await scorer.scorePackageLive(packageName);
    await writeCache(scored);
    await completeJob(row.id, {
      ok: true,
      result: {
        ok: true,
        packageName: scored.packageName,
        version: scored.version,
        score: scored.score,
        scanTier: scored.scanTier,
        source: 'computed',
        computedAt: scored.computedAt,
        expiresAt: new Date(Date.now() + LIVE_TTL_MS).toISOString(),
      },
    });
    console.log(`[deep-scan-worker] done ${packageName} score=${scored.score}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await completeJob(row.id, { ok: false, error: message });
    console.error(`[deep-scan-worker] failed ${packageName}: ${message}`);
  }
}

async function main() {
  const scorer = await loadScorer();
  console.log(`[deep-scan-worker] started (poll ${pollMs}ms)`);
  for (;;) {
    const row = await claimNext();
    if (row) {
      await runJob(row, scorer);
    } else {
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

main().catch((err) => {
  console.error('[deep-scan-worker] fatal', err);
  process.exit(1);
});
