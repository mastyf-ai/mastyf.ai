import { describe, it, expect } from 'vitest';
import * as jose from 'jose';
import { DPoPValidator } from '../../src/auth/dpop.js';

describe('DPoPValidator replay protection', () => {
  it('rejects replayed jti (SETNX-equivalent semantics)', async () => {
    const validator = new DPoPValidator();
    const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
    const jwk = await jose.exportJWK(publicKey);

    const proof = await new jose.SignJWT({
      htm: 'POST',
      htu: 'https://api.example/mcp',
      jti: 'unique-jti-001',
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt' })
      .setIssuedAt()
      .sign(privateKey);

    const first = await validator.validate(proof, jwk, 'POST', 'https://api.example/mcp');
    expect(first.valid).toBe(true);

    const replay = await validator.validate(proof, jwk, 'POST', 'https://api.example/mcp');
    expect(replay.valid).toBe(false);
    expect(replay.error).toContain('replay');
  });
});
