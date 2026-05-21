/**
 * URL guard — blocks SSRF-prone, local, and dangerous-scheme URLs in tool arguments.
 */
import { walkStringLeaves } from './arg-leaf-walker.js';
import { stripZeroWidthCharacters } from '../utils/payload-normalizer.js';
import { isTrustedDomainSquat } from '../utils/registrable-domain.js';

/** URL guard normalization — percent-decode + NFKC; avoids base64/hex blob decode on hostnames. */
function normalizeUrlInput(raw: string): string {
  let current = stripZeroWidthCharacters(raw.trim()).normalize('NFKC');
  for (let i = 0; i < 5; i++) {
    const before = current;
    current = current.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return _m;
      }
    });
    if (current === before) break;
  }
  return current;
}

const URL_ARG_FIELDS = new Set(['url', 'href', 'target', 'webhook', 'callback', 'link']);

/** Freetext fields that may embed http(s) URLs (SSRF in message/body, not only dedicated url keys). */
const FREETEXT_URL_ARG_FIELDS = new Set([
  ...URL_ARG_FIELDS,
  'message',
  'query',
  'body',
  'content',
  'text',
  'prompt',
]);

const PUPPETEER_TOOLS = new Set(['puppeteer_navigate', 'puppeteer_screenshot']);

/** Public documentation hosts allowed for benign corpus (ssrf-025/026). */
const DOCUMENTATION_HOST_ALLOWLIST = new Set([
  'example.com',
  'www.example.com',
  'docs.example.com',
]);

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

/** Normalize dotted-quad octets (e.g. 0177.0.0.1 → 127.0.0.1, 0x7f.0.0.1). */
function normalizeDottedHost(host: string): string {
  if (!/^[\d.x]+$/i.test(host) || !host.includes('.')) return host;
  const parts = host.split('.');
  if (parts.length !== 4) return host;
  const normalized: number[] = [];
  for (const part of parts) {
    if (/^0x[0-9a-f]+$/i.test(part)) {
      normalized.push(parseInt(part, 16) & 0xff);
    } else if (/^0[0-7]+$/.test(part) && part.length > 1) {
      normalized.push(parseInt(part, 8) & 0xff);
    } else {
      const n = parseInt(part, 10);
      if (!Number.isFinite(n) || n < 0 || n > 255) return host;
      normalized.push(n);
    }
  }
  return normalized.join('.');
}

export function isDangerousUrl(raw: string): { block: boolean; reason?: string } {
  const trimmed = normalizeUrlInput(raw);
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

  let host = hostnameFromParsed(parsed).toLowerCase();
  if (/^[\d.x]+$/i.test(host)) {
    host = normalizeDottedHost(host);
  }

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

  if (DOCUMENTATION_HOST_ALLOWLIST.has(host)) {
    return { block: false };
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
    if (FREETEXT_URL_ARG_FIELDS.has(keyLower)) {
      if (typeof val === 'string') values.push(val);
    } else if (scanAllLeaves && typeof val === 'string') {
      values.push(val);
    }
  }

  return values;
}

export function extractHttpUrlsFromLeaves(obj: unknown): string[] {
  const urls: string[] = [];
  for (const { path, value } of walkStringLeaves(obj)) {
    const key = path.split(/[.[\]]/).filter(Boolean).pop()?.toLowerCase() ?? '';
    if (FREETEXT_URL_ARG_FIELDS.has(key)) {
      urls.push(value);
    }
    for (const m of value.matchAll(HTTP_URL_IN_TEXT)) {
      urls.push(m[0]);
    }
  }
  return urls;
}

export interface UrlGuardResult {
  block: boolean;
  reason?: string;
}

function expandUrlCandidates(urls: string[]): string[] {
  const expanded: string[] = [];
  for (const raw of urls) {
    expanded.push(raw);
    for (const m of raw.matchAll(HTTP_URL_IN_TEXT)) {
      expanded.push(m[0]);
    }
  }
  return expanded;
}

export function evaluateUrlGuard(urls: string[]): UrlGuardResult {
  for (const raw of expandUrlCandidates(urls)) {
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
