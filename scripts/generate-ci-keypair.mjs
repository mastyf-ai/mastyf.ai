#!/usr/bin/env node
/**
 * Generate an Ed25519 keypair for CI token signing.
 *
 * The PRIVATE key (with 'd' parameter) goes to the maintainer:
 *   - Store in GitHub Secrets as GUARDIAN_CI_PRIVATE_KEY
 *   - Or save to a file referenced by GUARDIAN_CI_KEY_FILE
 *
 * The PUBLIC key (without 'd') is embedded in src/license/ci-token.ts.
 * This script can also output the patch-ready public key constant.
 *
 * Usage:
 *   node scripts/generate-ci-keypair.mjs                    # Generate new keypair
 *   node scripts/generate-ci-keypair.mjs --public-key-only   # Just show public key format
 */

import { subtle } from 'node:crypto';

async function main() {
  const keyPair = await subtle.generateKey(
    { name: 'Ed25519' },
    true, // extractable
    ['sign', 'verify'],
  );

  const privateJwk = await subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await subtle.exportKey('jwk', keyPair.publicKey);

  console.error('═══════════════════════════════════════════════════════');
  console.error('  MCP Guardian — CI Token Keypair');
  console.error('═══════════════════════════════════════════════════════');
  console.error('');
  console.error('PRIVATE KEY (keep secret — never commit to source):');
  console.error('─────────────────────────────────────────────────────');
  console.log(JSON.stringify(privateJwk));
  console.error('');
  console.error('─────────────────────────────────────────────────────');
  console.error('');
  console.error('Store as GitHub Secret: GUARDIAN_CI_PRIVATE_KEY');
  console.error('Or save to a file and set GUARDIAN_CI_KEY_FILE=<path>');
  console.error('');
  console.error('PUBLIC KEY (embed in src/license/ci-token.ts):');
  console.error('─────────────────────────────────────────────────────');
  console.error(`  kty: '${publicJwk.kty}',`);
  console.error(`  crv: '${publicJwk.crv}',`);
  console.error(`  x: '${publicJwk.x}',`);
  console.error('');
  console.error('═══════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error(`[ci-keypair] Error: ${err.message}`);
  process.exit(1);
});