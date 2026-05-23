import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

if (!process.env.MCP_GUARDIAN_DB_PATH) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-guardian-vitest-'));
  process.env.MCP_GUARDIAN_DB_PATH = join(dir, 'history.db');
}

/** Unlock Pro features in unit tests (license tests clear this explicitly). */
if (process.env.GUARDIAN_CI_BYPASS_LICENSE !== 'false') {
  process.env.GUARDIAN_CI_BYPASS_LICENSE = 'true';
}
