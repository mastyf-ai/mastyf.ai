import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as jose from 'jose';
import {
  isDpopRequired,
  validateRequiredDpop,
  resetDpopEnforcementForTests,
} from '../../src/auth/dpop-enforcement.js';

describe('GUARDIAN_REQUIRE_DPOP', () => {
  const prev = process.env.GUARDIAN_REQUIRE_DPOP;

  beforeEach(() => {
    resetDpopEnforcementForTests();
    delete process.env.GUARDIAN_REQUIRE_DPOP;
  });

  afterEach(() => {
    resetDpopEnforcementForTests();
    if (prev === undefined) delete process.env.GUARDIAN_REQUIRE_DPOP;
    else process.env.GUARDIAN_REQUIRE_DPOP = prev;
  });

  it('skips validation when flag is unset', async () => {
    expect(isDpopRequired()).toBe(false);
    const result = await validateRequiredDpop(undefined, 'POST', 'https://example/mcp');
    expect(result.valid).toBe(true);
  });

  it('rejects missing proof when GUARDIAN_REQUIRE_DPOP=true', async () => {
    process.env.GUARDIAN_REQUIRE_DPOP = 'true';
    expect(isDpopRequired()).toBe(true);
    const result = await validateRequiredDpop(undefined, 'POST', 'https://example/mcp');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/DPoP proof required/i);
  });

  it('accepts valid proof with jwk in header', async () => {
    process.env.GUARDIAN_REQUIRE_DPOP = 'true';
    const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
    const jwk = await jose.exportJWK(publicKey);

    const proof = await new jose.SignJWT({
      htm: 'POST',
      htu: 'https://example/mcp',
      jti: `jti-${Date.now()}`,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk })
      .setIssuedAt()
      .sign(privateKey);

    const result = await validateRequiredDpop(proof, 'POST', 'https://example/mcp');
    expect(result.valid).toBe(true);
  });
});
