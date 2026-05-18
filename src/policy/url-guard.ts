/**
 * URL guard — blocks SSRF-prone, local, and dangerous-scheme URLs in tool arguments.
 */
import { isTrustedDomainSquat } from '../utils/registrable-domain.js';

const URL_ARG_FIELDS = new Set(['url', 'href', 'target', 'webhook', 'callback']);

const PUPPETEER_TOOLS = new Set(['puppeteer_navigate', 'puppeteer_screenshot']);

const BLOCKED_SCHEMES = new Set(['file', 'javascript', 'data', 'vbscript', 'about']);

const LOCALHOST_NAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'metadata.google',
  'kubernetes.default.svc',
]);

/** Link-local / cloud metadata endpoints (SSRF). */
const METADATA_IPV4 = /^169\.254\./;

const PRIVATE_IPV4_OCTETS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT / shared
  /^169\.254\./,
];

const HTTP_URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;

function isPrivateOrLocalIpv4(host: string): boolean {
  return PRIVATE_IPV4_OCTETS.some((re) => re.test(host));
}

function isDecimalIpHost(host: string): boolean {
  if (!/^\d{1,10}$/.test(host)) return false;
  const n = Number(host);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) return false;
  return host === String(n);
}

function decimalIpToDotted(decimal: number): string {
  return [
    (decimal >>> 24) & 0xff,
    (decimal >>> 16) & 0xff,
    (decimal >>> 8) & 0xff,
    decimal & 0xff,
  ].join('.');
}

function isPrivateOrLocalIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:')) return true; // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA
  if (h.startsWith('::ffff:')) {
    const v4 = h.slice('::ffff:'.length);
    if (/^[\da-f.]+$/i.test(v4)) return isPrivateOrLocalIpv4(v4);
  }
  return false;
}

function parseUrlCandidate(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function hostnameFromParsed(url: URL): string {
  if (url.hostname.startsWith('[') && url.hostname.endsWith(']')) {
    return url.hostname.slice(1, -1);
  }
  return url.hostname;
}

export function isDangerousUrl(raw: string): { block: boolean; reason?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { block: false };

  const parsed = parseUrlCandidate(trimmed);
  if (!parsed) {
    if (/^(?:file|javascript|data|vbscript):/i.test(trimmed)) {
      return { block: true, reason: `Blocked URL scheme: ${trimmed.slice(0, 32)}` };
    }
    return { block: false };
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (BLOCKED_SCHEMES.has(scheme)) {
    return { block: true, reason: `Blocked URL scheme (${scheme})` };
  }

  const host = hostnameFromParsed(parsed).toLowerCase();

  if (LOCALHOST_NAMES.has(host) || host.endsWith('.localhost')) {
    return { block: true, reason: `Blocked localhost/metadata host: ${host}` };
  }

  if (isDecimalIpHost(host)) {
    const dotted = decimalIpToDotted(Number(host));
    if (isPrivateOrLocalIpv4(dotted) || METADATA_IPV4.test(dotted)) {
      return { block: true, reason: `Blocked decimal IP (maps to ${dotted})` };
    }
  }

  if (/^[\d.]+$/.test(host)) {
    if (isPrivateOrLocalIpv4(host) || METADATA_IPV4.test(host)) {
      return { block: true, reason: `Blocked private/metadata IP: ${host}` };
    }
  }

  if (host.includes(':') && isPrivateOrLocalIpv6(host)) {
    return { block: true, reason: `Blocked local/private IPv6: ${host}` };
  }

  if (METADATA_IPV4.test(host)) {
    return { block: true, reason: `Blocked metadata IP: ${host}` };
  }

  return { block: false };
}

export function extractUrlArgumentValues(
  args: Record<string, unknown> | undefined,
  toolName?: string,
): string[] {
  const values: string[] = [];
  if (!args) return values;

  const scanAllLeaves = toolName && PUPPETEER_TOOLS.has(toolName);

  for (const [key, val] of Object.entries(args)) {
    const keyLower = key.toLowerCase();
    if (URL_ARG_FIELDS.has(keyLower)) {
      if (typeof val === 'string') values.push(val);
    } else if (scanAllLeaves && typeof val === 'string') {
      values.push(val);
    }
  }

  return values;
}

export function extractHttpUrlsFromLeaves(obj: unknown): string[] {
  const urls: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      for (const m of node.matchAll(HTTP_URL_IN_TEXT)) {
        urls.push(m[0]);
      }
      return;
    }
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        const kl = key.toLowerCase();
        if (URL_ARG_FIELDS.has(kl) && typeof val === 'string') {
          urls.push(val);
        }
        walk(val);
      }
    }
  };
  walk(obj);
  return urls;
}

export interface UrlGuardResult {
  block: boolean;
  reason?: string;
}

export function evaluateUrlGuard(urls: string[]): UrlGuardResult {
  for (const raw of urls) {
    if (isTrustedDomainSquat(raw)) {
      return {
        block: true,
        reason: `Blocked trusted-domain subdomain squat: ${raw.slice(0, 80)}`,
      };
    }
    const check = isDangerousUrl(raw);
    if (check.block) {
      return { block: true, reason: check.reason ?? `Dangerous URL blocked: ${raw.slice(0, 80)}` };
    }
  }
  return { block: false };
}
