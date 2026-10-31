import bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const PREFIX = 'gcp_';
const KEY_BYTES = 32;
const WELL_FORMED_KEY = /^gcp_[A-Za-z0-9_-]{43}$/;

/** New keys are SHA-256 (they are 256-bit random); keys issued before migration 017 are bcrypt. */
export type ApiKeyHashScheme = 'bcrypt' | 'sha256';

export type GeneratedApiKey = {
  plaintext: string;
  prefix: string;
  hash: string;
  hashScheme: 'sha256';
};

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(KEY_BYTES).toString('base64url');
  const plaintext = `${PREFIX}${secret}`;
  const prefix = plaintext.slice(0, 12);
  const hash = hashApiKey(plaintext);
  return { plaintext, prefix, hash, hashScheme: 'sha256' };
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export function verifyApiKey(
  plaintext: string,
  hash: string,
  scheme: ApiKeyHashScheme = 'bcrypt',
): boolean {
  if (scheme === 'sha256') {
    const actual = Buffer.from(hashApiKey(plaintext), 'hex');
    const expected = Buffer.from(hash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  return bcrypt.compareSync(plaintext, hash);
}

/** True only for the exact shape generateApiKey produces, so junk never reaches the database. */
export function isWellFormedApiKey(token: string): boolean {
  return WELL_FORMED_KEY.test(token);
}

export function isCloudLicenseKey(token: string): boolean {
  return token.startsWith(PREFIX);
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.startsWith(PREFIX) ? token : null;
}

export function extractRawBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}
