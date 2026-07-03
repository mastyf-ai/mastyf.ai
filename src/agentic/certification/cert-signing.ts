/**
 * JWS-like HMAC attestation for MCP server certifications.
 * Uses MASTYF_AI_CERT_SIGNING_KEY or a persisted ~/.mastyf-ai/.cert-signing-key.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CertAttestationPayload {
  serverName: string;
  packageName: string;
  version: string;
  level: string;
  score: number;
  issuedAt: string;
  expiresAt: string;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function fromB64url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf-8');
}

function certSigningKeyPath(): string {
  const home = process.env['MASTYF_AI_HOME'] || join(homedir(), '.mastyf-ai');
  return join(home, '.cert-signing-key');
}

function loadOrCreatePersistedKey(): string | null {
  const path = certSigningKeyPath();
  try {
    if (existsSync(path)) {
      const key = readFileSync(path, 'utf8').trim();
      return key || null;
    }
    return null;
  } catch {
    return null;
  }
}

export function getCertSigningKey(): string {
  const fromEnv = process.env['MASTYF_AI_CERT_SIGNING_KEY']?.trim();
  if (fromEnv) return fromEnv;

  const persisted = loadOrCreatePersistedKey();
  if (persisted) {
    process.env['MASTYF_AI_CERT_SIGNING_KEY'] = persisted;
    return persisted;
  }

  throw new Error(
    'MASTYF_AI_CERT_SIGNING_KEY or persisted cert signing key is required for certification signing. ' +
    'Set a cryptographically random secret (e.g., openssl rand -hex 32).',
  );
}

export function signCertAttestation(payload: CertAttestationPayload): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'MASTYF_AI-CERT+JWS' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = createHmac('sha256', getCertSigningKey()).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function verifyCertAttestation(jws: string): { valid: boolean; payload?: CertAttestationPayload; reason?: string } {
  const parts = jws.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'invalid_jws_format' };

  const [header, body, signature] = parts;
  const signingInput = `${header}.${body}`;
  const expected = createHmac('sha256', getCertSigningKey()).update(signingInput).digest('base64url');

  try {
    const sigBuf = Buffer.from(signature!, 'base64url');
    const expBuf = Buffer.from(expected, 'base64url');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: 'bad_signature' };
    }
  } catch {
    return { valid: false, reason: 'bad_signature' };
  }

  try {
    const payload = JSON.parse(fromB64url(body!)) as CertAttestationPayload;
    if (!payload.serverName || !payload.issuedAt || !payload.expiresAt) {
      return { valid: false, reason: 'invalid_payload' };
    }
    if (new Date(payload.expiresAt).getTime() < Date.now()) {
      return { valid: false, reason: 'expired', payload };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'invalid_payload' };
  }
}
