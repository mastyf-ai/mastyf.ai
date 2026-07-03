import { PRODUCTION_SITE_URL } from './product-links';

/** Resolve the public site URL for links, OAuth callbacks, and badge embeds. */
export function resolveSiteUrl(request?: Request): string {
  const env =
    process.env.MASTYF_AI_CLOUD_PUBLIC_URL
    || process.env.NEXT_PUBLIC_CLOUD_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.AUTH_URL;
  if (env) return env.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  if (request) {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
  if (process.env.NODE_ENV === 'development') {
    const port = process.env.PORT || '3001';
    return `http://localhost:${port}`;
  }
  return PRODUCTION_SITE_URL;
}

/** Default control plane URL for self-hosted mastyf.ai proxies. */
export function defaultControlPlaneUrl(): string {
  return (
    process.env.MASTYF_AI_CONTROL_PLANE_URL?.trim()
    || process.env.NEXT_PUBLIC_APP_URL?.trim()
    || PRODUCTION_SITE_URL
  ).replace(/\/$/, '');
}
