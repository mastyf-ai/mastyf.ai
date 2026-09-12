import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const vitestHome = mkdtempSync(join(tmpdir(), 'mastyf-ai-vitest-home-'));

if (!process.env.MASTYF_AI_DB_PATH) {
  const dir = mkdtempSync(join(tmpdir(), 'mastyf-ai-vitest-'));
  process.env.MASTYF_AI_DB_PATH = join(dir, 'history.db');
}

/** Unlock Pro features in unit tests (license tests clear this explicitly). */
if (process.env.MASTYF_AI_CI_BYPASS_LICENSE !== 'false') {
  process.env.MASTYF_AI_CI_BYPASS_LICENSE = 'true';
}

/** Isolate from a developer laptop's live gateway, fleet merge, and threat catalog. */
if (process.env.MASTYF_AI_USE_GATEWAY_ARBITER === undefined) {
  process.env.MASTYF_AI_USE_GATEWAY_ARBITER = 'false';
}
if (process.env.MASTYF_AI_FLEET_CHILD === undefined) {
  process.env.MASTYF_AI_FLEET_CHILD = 'true';
}
if (process.env.MASTYF_AI_HOME === undefined) {
  process.env.MASTYF_AI_HOME = vitestHome;
}
if (process.env.MASTYF_HOME === undefined) {
  process.env.MASTYF_HOME = join(vitestHome, 'mastyf');
  mkdirSync(process.env.MASTYF_HOME, { recursive: true });
}
if (process.env.MASTYF_AI_THREAT_STATE_PATH === undefined) {
  const threatState = join(vitestHome, '.threat-state.json');
  writeFileSync(threatState, '{"entries":[],"catalog":[]}');
  process.env.MASTYF_AI_THREAT_STATE_PATH = threatState;
}
if (process.env.MASTYF_AI_CERT_SIGNING_KEY === undefined) {
  process.env.MASTYF_AI_CERT_SIGNING_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}
