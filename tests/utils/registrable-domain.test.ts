import { describe, it, expect } from 'vitest';
import { getRegistrableDomain, isTrustedDomainSquat } from '../../src/utils/registrable-domain.js';

describe('registrable-domain', () => {
  it('computes eTLD+1 for common hosts', () => {
    expect(getRegistrableDomain('www.example.com')).toBe('example.com');
    expect(getRegistrableDomain('sub.github.io')).toBe('sub.github.io');
  });

  it('flags suffix squatting of trusted domains', () => {
    expect(isTrustedDomainSquat('https://nvd.nist.gov.attacker.io/x')).toBe(true);
    expect(isTrustedDomainSquat('https://registry.npmjs.org/package')).toBe(false);
  });
});
