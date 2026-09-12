/**
 * Local dashboard API key — file-backed, never logged in full.
 * Auth is on by default, including loopback.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Logger } from './logger.js';

export function dashboardApiKeyPath(home = process.env.MASTYF_HOME): string {
  const root = (home && home.trim()) || join(homedir(), '.mastyf');
  return join(root, 'dashboard_api_key');
}

export function readDashboardApiKeyFile(home?: string): string | null {
  const path = dashboardApiKeyPath(home);
  if (!existsSync(path)) return null;
  try {
    const key = readFileSync(path, 'utf8').trim();
    return key.length >= 16 ? key : null;
  } catch {
    return null;
  }
}

/** Load or create `$MASTYF_HOME/dashboard_api_key` and export DASHBOARD_API_KEY. */
export function ensureLocalDashboardApiKey(): string {
  const fromEnv = process.env.DASHBOARD_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const path = dashboardApiKeyPath();
  const existing = readDashboardApiKeyFile();
  if (existing) {
    process.env.DASHBOARD_API_KEY = existing;
    return existing;
  }

  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(32).toString('hex');
  writeFileSync(path, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort */
  }
  process.env.DASHBOARD_API_KEY = key;
  Logger.info(`[dashboard] Wrote API key file ${path} (value not printed)`);
  return key;
}

export function describeDashboardApiKeySource(): string {
  if (process.env.DASHBOARD_API_KEY?.trim()) {
    return 'env DASHBOARD_API_KEY';
  }
  return dashboardApiKeyPath();
}
