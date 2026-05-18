import { describe, it, expect } from 'vitest';
import { evaluateUrlGuard } from '../../src/policy/url-guard.js';
import { getRegistrableDomain, isTrustedDomainSquat } from '../../src/utils/registrable-domain.js';

describe('Subdomain squatting / registrable domain', () => {
  it('parses registrable domain for squat host', () => {
    expect(getRegistrableDomain('nvd.nist.gov.attacker.io')).toBe('attacker.io');
    expect(getRegistrableDomain('services.nvd.nist.gov')).toBe('nist.gov');
  });

  it('detects trusted-domain suffix squat', () => {
    expect(isTrustedDomainSquat('https://nvd.nist.gov.attacker.io/cve')).toBe(true);
    expect(isTrustedDomainSquat('https://services.nvd.nist.gov/rest/json/cves/2.0')).toBe(false);
  });

  it('blocks squat URL via url-guard', () => {
    const result = evaluateUrlGuard(['https://nvd.nist.gov.attacker.io/exfil']);
    expect(result.block).toBe(true);
    expect(result.reason).toMatch(/squat/i);
  });

  it('allows legitimate nvd.nist.gov URL', () => {
    const result = evaluateUrlGuard(['https://services.nvd.nist.gov/rest/json/cves/2.0']);
    expect(result.block).toBe(false);
  });
});
