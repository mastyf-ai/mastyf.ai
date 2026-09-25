/**
 * Registrable domain (eTLD+1) helpers — prevents subdomain squatting on trusted hosts
 * (e.g. nvd.nist.gov.attacker.io must not match allowlist entry nist.gov).
 */
/**
 * Returns the registrable domain (eTLD+1) for a hostname.
 * @example getRegistrableDomain('www.example.com') → 'example.com'
 * @example getRegistrableDomain('nvd.nist.gov.attacker.io') → 'attacker.io'
 * @example getRegistrableDomain('services.nvd.nist.gov') → 'nist.gov'
 */
export declare function getRegistrableDomain(hostname: string): string;
/** Compare registrable domains for exact equality (anti-squatting). */
export declare function registrableDomainsMatch(hostname: string, trustedHostname: string): boolean;
export declare const DEFAULT_TRUSTED_EXFIL_DOMAINS: readonly ["api.osv.dev", "nvd.nist.gov", "deb.nodesource.com", "registry.npmjs.org"];
/** True when host is the trusted domain or a proper subdomain (registrable domain matches). */
export declare function isLegitimateTrustedHost(hostname: string, trusted: string): boolean;
/**
 * Returns true when URL host impersonates a trusted domain via suffix squatting.
 */
export declare function isTrustedDomainSquat(rawUrl: string, trustedDomains?: readonly string[]): boolean;
//# sourceMappingURL=registrable-domain.d.ts.map