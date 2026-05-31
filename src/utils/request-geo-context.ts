/**
 * Extract geo/time context from proxy HTTP headers for zero-trust scoring (C3).
 */
import type { IncomingHttpHeaders } from 'http';

export interface RequestGeoContext {
  geoRegion?: string;
  hourUtc: number;
}

export function extractRequestGeoContext(
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
): RequestGeoContext {
  const hourUtc = new Date().getUTCHours();
  if (!headers) return { hourUtc };

  const region =
    headerValue(headers['x-guardian-geo-region'])
    ?? headerValue(headers['cf-ipcountry'])
    ?? headerValue(headers['x-vercel-ip-country'])
    ?? headerValue(headers['x-geo-country']);

  return {
    geoRegion: region?.toUpperCase(),
    hourUtc,
  };
}

function headerValue(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
}

export function applyGeoToCallContext<T extends Record<string, unknown>>(
  ctx: T,
  headers?: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
): T & RequestGeoContext {
  const geo = extractRequestGeoContext(headers);
  return { ...ctx, ...geo };
}
