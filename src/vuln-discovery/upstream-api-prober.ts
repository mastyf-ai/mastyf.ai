/**
 * Bounded upstream API prober (DAST-lite) — allowlist-gated OpenAPI discovery + safe probes.
 */
import {
  isTargetAuthorized,
  checkProbeRateLimit,
  auditProbe,
  isVulnDiscoveryEnabled,
} from './auth.js';
import {
  createFindingId,
  fingerprintFinding,
  getFinding,
  upsertFinding,
} from './store.js';
import type { VulnFinding } from './types.js';

export interface UpstreamProbeResult {
  url: string;
  openApiFound: boolean;
  openApiUrl?: string;
  probesRun: number;
  findings: VulnFinding[];
  errors: string[];
}

async function fetchText(
  url: string,
  opts?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; body: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      method: opts?.method || 'GET',
      headers: opts?.headers,
      body: opts?.body,
      signal: ctrl.signal,
      redirect: 'manual',
    });
    const body = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body: body.slice(0, 8000) };
  } catch (err) {
    return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}

const OPENAPI_PATHS = [
  '/.well-known/openapi.json',
  '/openapi.json',
  '/swagger.json',
  '/v3/api-docs',
  '/api-docs',
];

function persistFinding(
  partial: Omit<VulnFinding, 'id' | 'discoveredAt' | 'fingerprint'>,
): VulnFinding {
  const fp = fingerprintFinding({
    class: partial.class,
    target: partial.target,
    title: partial.title,
    evidence: { scanner: partial.evidence.scanner, reproSteps: partial.evidence.reproSteps },
  });
  const id = createFindingId(fp);
  const existing = getFinding(id);
  return upsertFinding({
    ...partial,
    id,
    fingerprint: fp,
    discoveredAt: existing?.discoveredAt || new Date().toISOString(),
    status: existing?.status === 'validated' ? existing.status : partial.status,
    validatedAt: existing?.validatedAt,
    analysisReportId: existing?.analysisReportId,
  });
}

/** Probe a single allowlisted upstream base URL. Read-only by default. */
export async function probeUpstreamApi(baseUrl: string): Promise<UpstreamProbeResult> {
  const findings: VulnFinding[] = [];
  const errors: string[] = [];
  let probesRun = 0;

  if (!isVulnDiscoveryEnabled()) {
    return {
      url: baseUrl,
      openApiFound: false,
      probesRun: 0,
      findings: [],
      errors: ['vuln discovery disabled'],
    };
  }

  const auth = isTargetAuthorized(baseUrl);
  auditProbe({
    action: 'probe-start',
    target: baseUrl,
    authorized: auth.ok,
    detail: auth.reason,
  });
  if (!auth.ok) {
    return {
      url: baseUrl,
      openApiFound: false,
      probesRun: 0,
      findings: [],
      errors: [auth.reason],
    };
  }

  const rate = checkProbeRateLimit();
  if (!rate.ok) {
    return {
      url: baseUrl,
      openApiFound: false,
      probesRun: 0,
      findings: [],
      errors: [rate.reason],
    };
  }

  const base = baseUrl.replace(/\/$/, '');
  let openApiFound = false;
  let openApiUrl: string | undefined;

  for (const path of OPENAPI_PATHS) {
    probesRun++;
    const res = await fetchText(base + path);
    if (res.ok && (res.body.includes('openapi') || res.body.includes('swagger'))) {
      openApiFound = true;
      openApiUrl = base + path;
      break;
    }
  }

  // Safe read-only probes
  const probePaths = ['/', '/health', '/healthz', '/ready', '/metrics', '/admin', '/.env'];
  for (const path of probePaths) {
    probesRun++;
    const rate2 = checkProbeRateLimit();
    if (!rate2.ok) {
      errors.push(rate2.reason);
      break;
    }
    const res = await fetchText(base + path);
    // Exposed .env or admin without auth
    if (path === '/.env' && res.ok && /=/.test(res.body)) {
      findings.push(
        persistFinding({
          class: 'config',
          severity: 'CRITICAL',
          status: 'candidate',
          title: `Exposed .env at ${base}`,
          description: 'Upstream returned dotenv-like content without authentication',
          target: { kind: 'upstream_api', name: base, url: base + path },
          evidence: {
            scanner: 'upstream-api-prober',
            reproSteps: [`GET ${base}${path}`, `status=${res.status}`],
            response: res.body.slice(0, 500),
          },
          exploitability: { preAuth: true, networkReachable: true, userInteraction: false },
        }),
      );
    }
    if (path === '/admin' && res.status === 200 && !/login|sign.?in/i.test(res.body)) {
      findings.push(
        persistFinding({
          class: 'auth',
          severity: 'HIGH',
          status: 'candidate',
          title: `Unauthenticated /admin on ${base}`,
          description: 'Admin path returned 200 without obvious login gate',
          target: { kind: 'upstream_api', name: base, url: base + path },
          evidence: {
            scanner: 'upstream-api-prober',
            reproSteps: [`GET ${base}${path}`, `status=${res.status}`],
            response: res.body.slice(0, 300),
          },
          exploitability: { preAuth: true, networkReachable: true, userInteraction: false },
        }),
      );
    }
    // SSRF-ish: try metadata path on same host (should 404)
    if (path === '/health' && res.status >= 500) {
      findings.push(
        persistFinding({
          class: 'protocol',
          severity: 'MEDIUM',
          status: 'candidate',
          title: `Upstream 5xx on health: ${base}`,
          description: `Health endpoint returned ${res.status}`,
          target: { kind: 'upstream_api', name: base, url: base + path },
          evidence: {
            scanner: 'upstream-api-prober',
            reproSteps: [`GET ${base}${path}`, `status=${res.status}`],
          },
          exploitability: { preAuth: true, networkReachable: true, userInteraction: false },
        }),
      );
    }
  }

  // Header injection smoke (read-only GET with odd headers)
  probesRun++;
  const hdr = await fetchText(base + '/', {
    headers: {
      'X-Forwarded-For': '127.0.0.1',
      'X-Original-URL': '/admin',
      Authorization: 'Bearer invalid-token-probe',
    },
  });
  if (hdr.status === 200 && /admin|dashboard|root/i.test(hdr.body) && openApiFound === false) {
    // weak signal — info only
    findings.push(
      persistFinding({
        class: 'auth',
        severity: 'INFO',
        status: 'candidate',
        title: `Header probe interesting response on ${base}`,
        description: 'Non-standard headers produced 200 with admin-like content — review manually',
        target: { kind: 'upstream_api', name: base, url: base },
        evidence: {
          scanner: 'upstream-api-prober',
          reproSteps: ['GET / with X-Original-URL: /admin', `status=${hdr.status}`],
        },
        exploitability: { preAuth: true, networkReachable: true, userInteraction: false },
      }),
    );
  }

  auditProbe({
    action: 'probe-complete',
    target: baseUrl,
    authorized: true,
    detail: `probes=${probesRun} findings=${findings.length} openapi=${openApiFound}`,
  });

  return { url: baseUrl, openApiFound, openApiUrl, probesRun, findings, errors };
}

export async function probeUpstreamApis(urls: string[]): Promise<UpstreamProbeResult[]> {
  const out: UpstreamProbeResult[] = [];
  for (const url of urls) {
    out.push(await probeUpstreamApi(url));
  }
  return out;
}
