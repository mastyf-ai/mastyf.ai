import type { IncomingHttpHeaders } from 'http';

const DEFAULT_MAX_JSON_DEPTH = 32;

export function getHttpMaxBodyBytes(): number {
  const raw = process.env['GUARDIAN_HTTP_MAX_BODY_BYTES'];
  if (raw === undefined || raw === '') return 10 * 1024 * 1024;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 10 * 1024 * 1024;
}

export function getHttpMaxJsonDepth(): number {
  const raw = process.env['GUARDIAN_HTTP_MAX_JSON_DEPTH'];
  if (raw === undefined || raw === '') return DEFAULT_MAX_JSON_DEPTH;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_JSON_DEPTH;
}

export function containsCrlf(value: string): boolean {
  return /[\r\n]/.test(value);
}

/** Reject header names/values with CRLF injection. */
export function validateRequestHeaders(headers: IncomingHttpHeaders): string | null {
  for (const [key, val] of Object.entries(headers)) {
    if (containsCrlf(key)) return 'Invalid header name';
    if (val === undefined) continue;
    const values = Array.isArray(val) ? val : [val];
    for (const v of values) {
      if (containsCrlf(String(v))) return 'Invalid header value';
    }
  }
  return null;
}

/** Reject path traversal in request URL path. */
export function validateRequestUrlPath(url: string | undefined): string | null {
  if (!url) return null;
  const path = url.split('?')[0] || '/';
  const lower = path.toLowerCase();
  if (
    path.includes('..') ||
    lower.includes('%2e%2e') ||
    lower.includes('%252e') ||
    lower.includes('\\')
  ) {
    return 'Path traversal not allowed';
  }
  return null;
}

/** Host must be a sane hostname (no CRLF, spaces, or scheme). */
export function validateHostHeader(host: string | string[] | undefined): string | null {
  if (host === undefined) return null;
  const value = Array.isArray(host) ? host[0] : host;
  if (!value || containsCrlf(value)) return 'Invalid Host header';
  if (/[\s/\\]/.test(value) || value.includes('://')) return 'Invalid Host header';
  if (!/^[a-zA-Z0-9._:-]+$/.test(value.split(':')[0] || '')) {
    return 'Invalid Host header';
  }
  return null;
}

export function isXmlContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.includes('application/xml') || ct.includes('text/xml') || ct.includes('+xml');
}

export function looksLikeXmlBody(body: string): boolean {
  const trimmed = body.trimStart();
  return trimmed.startsWith('<?xml') || trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<');
}

export function jsonDepth(value: unknown, depth = 0, maxDepth = getHttpMaxJsonDepth()): boolean {
  if (depth > maxDepth) return false;
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (!jsonDepth(child, depth + 1, maxDepth)) return false;
    }
  }
  return true;
}

export function parseJsonWithDepthLimit(
  text: string,
  maxDepth = getHttpMaxJsonDepth(),
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text) as unknown;
    if (!jsonDepth(value, 0, maxDepth)) {
      return { ok: false, error: 'JSON nesting too deep' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
}

/** Strip CRLF from upstream response headers before forwarding. */
export function sanitizeResponseHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, val] of Object.entries(headers)) {
    if (containsCrlf(key)) continue;
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      const clean = val.filter((v) => !containsCrlf(String(v)));
      if (clean.length > 0) out[key] = clean;
    } else if (!containsCrlf(String(val))) {
      out[key] = val;
    }
  }
  return out;
}

/** Proxy must not reflect arbitrary Origin into ACAO. */
export function applySafeCorsHeaders(
  reqHeaders: IncomingHttpHeaders,
  resHeaders: Record<string, string | string[] | undefined>,
): void {
  const origin = reqHeaders['origin'];
  if (!origin) return;
  const originStr = Array.isArray(origin) ? origin[0] : origin;
  if (!originStr || containsCrlf(originStr)) return;
  // Never echo attacker Origin; only same-origin style hosts are allowed for ACAO.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(originStr)) {
    resHeaders['access-control-allow-origin'] = originStr;
  }
}
