/**
 * Registrable domain (eTLD+1) helpers — prevents subdomain squatting on trusted hosts
 * (e.g. nvd.nist.gov.attacker.io must not match allowlist entry nist.gov).
 */

/** Common multi-label public suffixes (minimal PSL subset). */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'org.br', 'net.br',
  'github.io', 'pages.dev',
]);

/** Single-label public suffixes — registrable domain is the label immediately before these. */
const SINGLE_SUFFIXES = new Set([
  'com', 'net', 'org', 'io', 'dev', 'app', 'ai', 'co', 'me', 'us', 'eu',
  'gov', 'edu', 'mil', 'int',
]);

/**
 * Returns the registrable domain (eTLD+1) for a hostname.
 * @example getRegistrableDomain('www.example.com') → 'example.com'
 * @example getRegistrableDomain('nvd.nist.gov.attacker.io') → 'attacker.io'
 * @example getRegistrableDomain('services.nvd.nist.gov') → 'nist.gov'
 */
export function getRegistrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost') return host;

  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 1) return host;

  for (let i = 1; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.');
    if (MULTI_PART_SUFFIXES.has(suffix)) {
      const registrable = labels.slice(i - 1).join('.');
      return registrable || host;
    }
  }

  const last = labels[labels.length - 1];
  if (SINGLE_SUFFIXES.has(last) && labels.length >= 2) {
    return labels.slice(-2).join('.');
  }

  if (labels.length === 2) return host;
  return labels.slice(-2).join('.');
}

/** Compare registrable domains for exact equality (anti-squatting). */
export function registrableDomainsMatch(hostname: string, trustedHostname: string): boolean {
  return getRegistrableDomain(hostname) === getRegistrableDomain(trustedHostname);
}

export const DEFAULT_TRUSTED_EXFIL_DOMAINS = [
  'api.osv.dev',
  'nvd.nist.gov',
  'deb.nodesource.com',
  'registry.npmjs.org',
] as const;

function parseHostname(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True when host is the trusted domain or a proper subdomain (registrable domain matches). */
export function isLegitimateTrustedHost(hostname: string, trusted: string): boolean {
  const host = hostname.toLowerCase();
  const t = trusted.toLowerCase();
  if (host === t) return true;
  if (host.endsWith(`.${t}`)) {
    return registrableDomainsMatch(host, t);
  }
  return false;
}

/**
 * Returns true when URL host impersonates a trusted domain via suffix squatting.
 */
export function isTrustedDomainSquat(
  rawUrl: string,
  trustedDomains: readonly string[] = DEFAULT_TRUSTED_EXFIL_DOMAINS,
): boolean {
  const host = parseHostname(rawUrl);
  if (!host) return false;

  const registrable = getRegistrableDomain(host);

  for (const trusted of trustedDomains) {
    const t = trusted.toLowerCase();
    if (isLegitimateTrustedHost(host, t)) continue;

    const trustedInHost =
      host === t ||
      host.endsWith(`.${t}`) ||
      host.includes(`.${t}.`) ||
      host.startsWith(`${t}.`);

    if (!trustedInHost) continue;

    const trustedRegistrable = getRegistrableDomain(t);
    if (registrable !== trustedRegistrable && !registrable.endsWith(`.${trustedRegistrable}`)) {
      return true;
    }
  }
  return false;
}
