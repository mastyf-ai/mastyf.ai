/**
 * Where the checks come from, in order:
 *
 * 1. MASTYF_CHECK_URL (+ MASTYF_CHECK_TOKEN): a check service you run (e.g. the Docker image).
 * 2. A free check service already running on this machine (127.0.0.1:4100, its token file readable).
 *    It must first prove it knows the token (it signs a random nonce); anything else listening on
 *    that port never receives the token.
 * 3. The Shield app (paid) on this machine: not available until Shield's next release defines how a
 *    client finds it and knows the answer really came from Shield.
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
  const client = new CheckClient(localUrl, token);
  const nonce = randomBytes(16).toString('hex');
  const health = await client.health(nonce);
  if (!health || health['tier'] !== 'free') return null;
  const expected = Buffer.from(createHmac('sha256', token).update(nonce).digest('hex'));
  const proof = Buffer.from(String(health['proof'] ?? ''));
  if (proof.length !== expected.length || !timingSafeEqual(proof, expected)) return null;
  return { client, tier: 'free' };
}

/** The paid Shield app's check API. Shield's next release defines the contract; until then nothing. */
export async function shieldClient(): Promise<Found | null> {
  return null;
}
