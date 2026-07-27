/**
 * Vuln discovery authorization — allowlist/denylist for upstream probing.
 *
 * Env:
 *   MASTYF_AI_VULN_DISCOVERY_ENABLED=false
 *   MASTYF_AI_VULN_DISCOVERY_ALLOWLIST=localhost,*.internal.company.com
 *   MASTYF_AI_VULN_DISCOVERY_DENYLIST= (optional extra deny hosts)
 *   MASTYF_AI_VULN_DISCOVERY_MAX_PROBES_PER_MIN=30
 */
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureVulnStoreDir } from './paths.js';

const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.azure.com',
]);

const DEFAULT_DENY_CIDRS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^localhost$/i,
];

function parseList(envVal: string | undefined): string[] {
  if (!envVal?.trim()) return [];
  return envVal.split(',').map((s) => s.trim()).filter(Boolean);
}

export function isVulnDiscoveryEnabled(): boolean {
  return process.env.MASTYF_AI_VULN_DISCOVERY_ENABLED === 'true';
}

export function getAllowlist(): string[] {
  return parseList(process.env.MASTYF_AI_VULN_DISCOVERY_ALLOWLIST);
}

export function getDenylist(): string[] {
  return parseList(process.env.MASTYF_AI_VULN_DISCOVERY_DENYLIST);
}

function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // .example.com
    return h.endsWith(suffix) || h === p.slice(2);
  }
  return h === p;
}

function isPrivateOrLocal(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  if (METADATA_HOSTS.has(h)) return true;
  return DEFAULT_DENY_CIDRS.some((re) => re.test(h));
}

/**
 * Returns true if the URL/host is authorized for active vuln probing.
 * Default deny: private RFC1918 / localhost / metadata unless allowlisted.
 */
export function isTargetAuthorized(urlOrHost: string): { ok: boolean; reason: string } {
  if (!isVulnDiscoveryEnabled()) {
    return { ok: false, reason: 'MASTYF_AI_VULN_DISCOVERY_ENABLED is not true' };
  }

  let host: string;
  try {
    if (urlOrHost.includes('://')) {
      host = new URL(urlOrHost).hostname;
    } else {
      host = urlOrHost.split('/')[0].split(':')[0];
    }
  } catch {
    return { ok: false, reason: 'invalid URL/host' };
  }

  const denylist = getDenylist();
  if (denylist.some((p) => hostMatchesPattern(host, p))) {
    return { ok: false, reason: `host ${host} is denylisted` };
  }

  if (METADATA_HOSTS.has(host)) {
    return { ok: false, reason: 'cloud metadata endpoints are always denied' };
  }

  const allowlist = getAllowlist();
  if (allowlist.length === 0) {
    return {
      ok: false,
      reason: 'MASTYF_AI_VULN_DISCOVERY_ALLOWLIST is empty — set allowed hosts explicitly',
    };
  }

  const allowlisted = allowlist.some((p) => hostMatchesPattern(host, p));
  if (!allowlisted) {
    return { ok: false, reason: `host ${host} not in allowlist` };
  }

  // Private IPs allowed only when explicitly allowlisted (already checked)
  if (isPrivateOrLocal(host) && !allowlisted) {
    return { ok: false, reason: `private/local host ${host} not allowlisted` };
  }

  return { ok: true, reason: 'authorized' };
}

const probeTimestamps: number[] = [];

export function checkProbeRateLimit(): { ok: boolean; reason: string } {
  const max = parseInt(process.env.MASTYF_AI_VULN_DISCOVERY_MAX_PROBES_PER_MIN || '30', 10);
  const now = Date.now();
  while (probeTimestamps.length && now - probeTimestamps[0] > 60_000) {
    probeTimestamps.shift();
  }
  if (probeTimestamps.length >= max) {
    return { ok: false, reason: `probe rate limit exceeded (${max}/min)` };
  }
  probeTimestamps.push(now);
  return { ok: true, reason: 'ok' };
}

export function auditProbe(event: {
  action: string;
  target: string;
  authorized: boolean;
  detail?: string;
}): void {
  const dir = ensureVulnStoreDir();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  });
  try {
    appendFileSync(join(dir, 'vuln-discovery-audit.jsonl'), line + '\n');
  } catch {
    /* best-effort audit trail; never fail the probe */
  }
}
