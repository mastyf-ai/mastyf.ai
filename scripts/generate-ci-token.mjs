#!/usr/bin/env node
/**
 * Generate a GUARDIAN_CI_TOKEN (Ed25519-signed JWT) for CI pipelines.
 *
 * Usage:
 *   node scripts/generate-ci-token.mjs [expiry-days]
 *   node scripts/generate-ci-token.mjs 30    # 30-day token
 *   node scripts/generate-ci-token.mjs 90    # 90-day token
 *
 * Requires: GUARDIAN_CI_PRIVATE_KEY env var (Ed25519 JWK) or
 * a key file at the path in GUARDIAN_CI_KEY_FILE.
 *
 * The private key is NEVER embedded in the source or dist.
 * Only the public key lives in src/license/ci-token.ts.
 *
 * Output: base64url-encoded JWT to stdout. Set as GUARDIAN_CI_TOKEN.
 */

import { subtle } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

function parseJwk(raw) {
  try {
    if (typeof raw !== 'string') throw new Error('not a string');
    const jwk = JSON.parse(raw);
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
      throw new Error('JWK must be Ed25519 (kty=OKP, crv=Ed25519)');
    }
    if (!jwk.d) throw new Error('private key missing (d parameter)');
    return jwk;
  } catch (err) {
    console.error(`[ci-token] Invalid private key: ${err.message}`);
    process.exit(1);
  }
}

async function getPrivateKey() {
  // 1. Try env var
  if (process.env['GUARDIAN_CI_PRIVATE_KEY']) {
    return parseJwk(process.env['GUARDIAN_CI_PRIVATE_KEY']);
  }

  // 2. Try key file
  const keyFile = process.env['GUARDIAN_CI_KEY_FILE'];
  if (keyFile && existsSync(keyFile)) {
    return parseJwk(readFileSync(keyFile, 'utf-8'));
  }

  console.error('[ci-token] No private key found. Set GUARDIAN_CI_PRIVATE_KEY or GUARDIAN_CI_KEY_FILE.');
  console.error('[ci-token] Generate a key pair: node scripts/generate-ci-keypair.mjs');
  process.exit(1);
}

async function main() {
  const privateJwk = await getPrivateKey();
  const key = await subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );

  const days = parseInt(process.argv[2] || '90', 10);
  if (!Number.isFinite(days) || days < 1) {
    console.error('[ci-token] Invalid expiry days:', process.argv[2]);
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const iat = now - 5; // 5s clock skew tolerance
  const exp = now + days * 86400;

  const header = { alg: 'EdDSA', typ: 'JWT' };
  const payload = {
    sub: 'ci-github-actions',
    iat,
    exp,
    features: ['dashboard', 'swarm', 'ai', 'audit', 'metrics', 'cost', 'health', 'fleet', 'admin', 'multi_tenant', 'semantic_async'],
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const signature = await subtle.sign({ name: 'Ed25519' }, key, signingInput);
  const signatureB64 = Buffer.from(signature).toString('base64url');

  const token = `${headerB64}.${payloadB64}.${signatureB64}`;

  console.log(token);
  console.error(`\n[ci-token] Token generated (expires in ${days} days):`);
  console.error(`  Expires: ${new Date(exp * 1000).toISOString()}`);
  console.error(`  Usage: export GUARDIAN_CI_TOKEN="${token}"`);
  console.error(`  Or add to CI secrets as GUARDIAN_CI_TOKEN`);
}

main().catch((err) => {
  console.error(`[ci-token] Error: ${err.message}`);
  process.exit(1);
});