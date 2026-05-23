/**
 * CI automation token verification.
 *
 * Instead of a plain env-var bypass (GUARDIAN_CI_BYPASS_LICENSE=true),
 * CI pipelines must present a JWT signed with the maintainer's Ed25519 private key.
 *
 * The corresponding public key is embedded at build time. Without the private key,
 * a token cannot be forged.
 *
 * Generate tokens with:
 *   node scripts/generate-ci-token.mjs <expiry-days>
 */
import { subtle } from 'node:crypto';
import { Logger } from '../utils/logger.js';

// ── Embedded Ed25519 public key (SPKI JWK) ──────────────────────────
// Private key is held by the maintainer — never shipped in source or dist.
const CI_TOKEN_PUBLIC_KEY_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
};

// Cache the imported key between verifications.
let _cachedCryptoKey: CryptoKey | null = null;

async function importPublicKey(): Promise<CryptoKey> {
  if (_cachedCryptoKey) return _cachedCryptoKey;
  _cachedCryptoKey = await subtle.importKey(
    'jwk',
    CI_TOKEN_PUBLIC_KEY_JWK,
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return _cachedCryptoKey;
}

export type CiTokenPayload = {
  sub: string;        // e.g. "ci-github-actions"
  iat: number;        // issued at (epoch seconds)
  exp: number;        // expiration (epoch seconds)
  features?: string[]; // optional: limit to specific Pro features
};

let _verifiedPayloadCache: { payload: CiTokenPayload; verifiedAt: number } | null = null;

function getToken(): string | undefined {
  return process.env['GUARDIAN_CI_TOKEN']?.trim() || undefined;
}

function tokenCacheValid(): boolean {
  if (!_verifiedPayloadCache) return false;
  const age = Date.now() - _verifiedPayloadCache.verifiedAt;
  return age < 5 * 60 * 1000; // 5-minute cache
}

/** Verify a CI token against the embedded public key. Returns the payload or null. */
export async function verifyCiToken(): Promise<CiTokenPayload | null> {
  const token = getToken();
  if (!token) return null;

  // Return cached result if still fresh.
  if (tokenCacheValid()) return _verifiedPayloadCache!.payload;

  const parts = token.split('.');
  if (parts.length !== 3) {
    Logger.warn('[license] CI token malformed (expected 3-part JWT)');
    return null;
  }

  try {
    const headerB64 = parts[0];
    const payloadB64 = parts[1];
    const signatureB64 = parts[2];

    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    if (header.alg !== 'EdDSA') {
      Logger.warn(`[license] CI token unsupported alg: ${header.alg}`);
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as CiTokenPayload;
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      Logger.warn('[license] CI token expired');
      return null;
    }

    if (payload.iat && payload.iat > now + 60) {
      Logger.warn('[license] CI token issued in the future');
      return null;
    }

    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(signatureB64, 'base64url');

    const key = await importPublicKey();
    const valid = await subtle.verify({ name: 'Ed25519' }, key, signature, signingInput);

    if (!valid) {
      Logger.warn('[license] CI token signature invalid');
      return null;
    }

    _verifiedPayloadCache = { payload, verifiedAt: Date.now() };
    return payload;
  } catch (err) {
    Logger.warn(`[license] CI token verification error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Lightweight synchronous check: is a valid token cached? */
export function isCiTokenCached(): boolean {
  return tokenCacheValid();
}

/** Check if the current process has a valid CI token (runs verification on first call, caches result). */
export async function isCiLicenseTokenValid(): Promise<boolean> {
  return (await verifyCiToken()) !== null;
}

/** Clear the verification cache (for tests). */
export function resetCiTokenCache(): void {
  _cachedCryptoKey = null;
  _verifiedPayloadCache = null;
}