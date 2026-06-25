/**
 * Documentation / schema URL hosts excluded from MCPG-R-020 exfiltration alerts.
 * Suffix matching: `github.com` allows `docs.github.com`, `api.github.com`, etc.
 */

const DEFAULT_SAFE_URL_SUFFIXES = [
  "schema.org",
  "json-schema.org",
  "openapi.org",
  "w3.org",
  "ietf.org",
  "rfc-editor.org",
  "docs.openai.com",
  "platform.openai.com",
  "openai.com",
  "docs.anthropic.com",
  "anthropic.com",
  "github.com",
  "github.io",
  "raw.githubusercontent.com",
  "gist.github.com",
  "gitlab.com",
  "developer.mozilla.org",
  "mozilla.org",
  "docs.microsoft.com",
  "learn.microsoft.com",
  "microsoft.com",
  "npmjs.com",
  "nodejs.org",
  "readthedocs.io",
  "wikipedia.org",
  "wikimedia.org",
  "developers.google.com",
  "cloud.google.com",
  "docs.aws.amazon.com",
  "aws.amazon.com",
  "kubernetes.io",
  "python.org",
  "typescriptlang.org",
  "modelcontextprotocol.io",
  "stripe.com",
  "supabase.com",
  "vercel.com",
  "postgresql.org",
  "mongodb.com",
  "elastic.co",
  "grafana.com",
  "prometheus.io",
  "localhost",
  "127.0.0.1",
  "[::1]",
];

const URL_IN_TEXT = /https?:\/\/[^\s)\]>'"`,]+/gi;

let cachedSuffixes: string[] | null = null;

function loadSafeUrlSuffixes(): string[] {
  if (cachedSuffixes) return cachedSuffixes;
  const extra = (process.env["MASTYF_AI_SAFE_URL_HOSTS"] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  cachedSuffixes = [...new Set([...DEFAULT_SAFE_URL_SUFFIXES, ...extra])];
  return cachedSuffixes;
}

/** @internal */
export function resetSafeUrlAllowlistCacheForTests(): void {
  cachedSuffixes = null;
}

export function isSafeUrlHost(hostname: string, suffixes = loadSafeUrlSuffixes()): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  for (const suffix of suffixes) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

export function extractHttpUrls(text: string): string[] {
  return [...text.matchAll(URL_IN_TEXT)].map((m) => m[0]);
}

export function findUnsafeUrls(text: string): string[] {
  const unsafe: string[] = [];
  for (const raw of extractHttpUrls(text)) {
    try {
      const hostname = new URL(raw).hostname;
      if (!isSafeUrlHost(hostname)) unsafe.push(raw);
    } catch {
      unsafe.push(raw);
    }
  }
  return unsafe;
}

export function getSafeUrlSuffixes(): readonly string[] {
  return loadSafeUrlSuffixes();
}
