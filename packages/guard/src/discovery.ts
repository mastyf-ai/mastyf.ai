/**
 * Where the checks come from, in order:
 *
 * 1. MASTYF_CHECK_URL (+ MASTYF_CHECK_TOKEN): a check service you run (e.g. the Docker image).
 * 2. The Shield app (paid) on this machine: its address and token are in Shield's owner-only file
 *    (%APPDATA%\Mastyf\shield\check.json, or ~/.mastyf/shield/check.json). Used only on 127.0.0.1,
 *    and only after it proves it knows the token and says it is Shield.
 * 3. A free check service already running on this machine (127.0.0.1:4100, its token file readable).
 *    It must first prove it knows the token (it signs a random nonce); anything else listening on
 *    that port never receives the token.
 * 4. The free check engine bundled with @mastyf_ai/check, started by this library.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CheckClient } from './client.js';

let localUrl = 'http://127.0.0.1:4100';

/** Tests only: where the "already running" local service is looked for. */
export function _setLocalUrlForTests(url: string): void {
  localUrl = url;
}

export interface Found {
  client: CheckClient;
  tier: string;
}

type Env = Record<string, string | undefined>;

/** The free service's token file: ~/.mastyf/check/token (Windows: %APPDATA%\Mastyf\check\token). */
export function tokenPath(env: Env, home: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return join(env['APPDATA'] || join(home, 'AppData', 'Roaming'), 'Mastyf', 'check', 'token');
  return join(home, '.mastyf', 'check', 'token');
}

export async function configured(env: Env): Promise<Found | null> {
  const url = env['MASTYF_CHECK_URL'];
  if (!url) return null;
  const client = new CheckClient(url, env['MASTYF_CHECK_TOKEN'] ?? '');
  const health = (await client.health()) ?? {};
  client.limitBody(health['maxBodyBytes']);
  return { client, tier: String(health['tier'] ?? 'free') };
}

export async function runningLocal(env: Env, home: string): Promise<Found | null> {
  let token: string;
  try {
    token = readFileSync(tokenPath(env, home), 'utf8').trim();
  } catch {
    return null;
  }
  if (token.length < 32) return null;
  return proven(localUrl, token, 'free');
}

/** Where the Shield app writes its check API's address and token. */
export function shieldFilePath(env: Env, home: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return join(env['APPDATA'] || join(home, 'AppData', 'Roaming'), 'Mastyf', 'shield', 'check.json');
  return join(home, '.mastyf', 'shield', 'check.json');
}

/** A check service on this machine that proves it knows `token` and reports `tier`; else null. */
async function proven(url: string, token: string, tier: string): Promise<Found | null> {
  const client = new CheckClient(url, token);
  const nonce = randomBytes(16).toString('hex');
  const health = await client.health(nonce);
  if (!health || health['tier'] !== tier) return null;
  const expected = Buffer.from(createHmac('sha256', token).update(nonce).digest('hex'));
  const proof = Buffer.from(String(health['proof'] ?? ''));
  if (proof.length !== expected.length || !timingSafeEqual(proof, expected)) return null;
  client.limitBody(health['maxBodyBytes']);
  return { client, tier };
}

/** The paid Shield app's check API, when Shield is running on this machine. */
export async function shieldClient(env: Env, home: string): Promise<Found | null> {
  let found: { url?: unknown; token?: unknown };
  try {
    found = JSON.parse(readFileSync(shieldFilePath(env, home), 'utf8'));
  } catch {
    return null;
  }
  const { url, token } = found ?? {};
  // Only this machine: the token must never go anywhere a changed file could point it.
  if (typeof url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(url)) return null;
  if (typeof token !== 'string' || token.length < 32) return null;
  return proven(url, token, 'shield');
}
