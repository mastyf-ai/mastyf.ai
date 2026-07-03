import { TRIBUNAL_BATCH_LIMIT } from './tribunal-config';
import { formatDownloadWindowSuffix, toWindowQueryParam } from './format-dashboard-window';

export type MastyfAiHeaders = Record<string, string>;

const TENANT_STORAGE_KEY = 'mastyf-ai-tenant-id';

export type AuditEvent = {
  timestamp: string;
  server_name: string;
  tool_name: string;
  action: 'block' | 'pass' | string;
  rule: string | null;
  reason: string | null;
  tenant_id?: string | null;
  cost_usd?: number | null;
  model?: string | null;
};

export type AuditResponse = {
  events: AuditEvent[];
  total: number;
  blocked: number;
  passed: number;
  flagged: number;
  semanticAudit?: { queued: number; processed: number; flagged: number; enabled: boolean };
};

export type ChartMeta = {
  window?: string;
  windowDays?: number;
  generatedAt?: string;
  recordCount?: number;
  sparse?: boolean;
  dataSources?: string[];
  emptyReason?: string;
};

export type KpiComparison = {
  deltaPct: number | null;
  deltaAbs: number;
  direction: 'up' | 'down' | 'flat';
};

export type AggregateMetrics = {
  available?: boolean;
  totalRequests: number;
  blockedRequests: number;
  passedRequests: number;
  totalCost: number;
  avgLatencyMs: number;
  /** 0–100 percent, not a 0–1 fraction; null when no calls yet */
  passRate: number | null;
  activeServers?: number;
  lastUpdated?: string;
  burnRatePerHour?: number | null;
  meta?: ChartMeta;
  error?: string;
};

export type CostCoverage = {
  pricedCalls: number;
  unpricedCalls: number;
  totalCalls: number;
  coveragePct: number;
  measuredUsd: number;
  disclaimer: string;
};

export type CostResponse = {
  available?: boolean;
  totalCost: number | null;
  projectedMonthly?: number | null;
  burnRatePerHour?: number | null;
  budgetUsd?: number | null;
  pricingModel?: string;
  windowDays?: number;
  costCoverage?: CostCoverage;
  disclaimer?: string;
  serverReports?: Array<{
    name: string;
    cost: number;
    tokens: number;
    trend?: string;
    unpriced?: number;
  }>;
  budgetAlerts?: string[];
  meta?: ChartMeta;
  error?: string;
};

export type MastyfAiFullAnalysisResponse = {
  available?: boolean;
  generatedAt?: string;
  windowDays?: number;
  verdict?: 'healthy' | 'attention' | 'critical';
  plainEnglishSummary?: string;
  markdown?: string;
  sections?: {
    protection: string[];
    traffic: string[];
    security: string[];
    learning: string[];
    nextSteps: string[];
  };
  citations?: Array<{ id: string; source: string; text: string }>;
  source?: 'measured' | 'llm';
  provider?: string;
  model?: string;
  narrative?: string;
  costCoverage?: {
    pricedCalls: number;
    unpricedCalls: number;
    coveragePct: number;
    disclaimer: string;
    measuredUsd?: number;
  };
  error?: string;
};

export type CostBreakdownResponse = {
  available?: boolean;
  windowDays?: number;
  tools?: Array<{ server: string; tool: string; calls: number; costUsd: number }>;
  error?: string;
};

export type CostTimeseriesResponse = {
  available?: boolean;
  windowDays?: number;
  granularity?: 'hour' | 'day';
  series?: Array<{ bucket: string; server: string; costUsd: number; calls: number }>;
  totalsByServer?: Array<{ server: string; costUsd: number; calls: number }>;
  pivoted?: Array<{ bucket: string; total: number; [server: string]: string | number }>;
  meta?: ChartMeta;
  comparison?: {
    totalCostUsd: KpiComparison;
  };
  error?: string;
};

export type ExecutiveSummaryResponse = {
  available?: boolean;
  timestamp?: string;
  windowDays?: number;
  totalRequests?: number;
  blockedRequests?: number;
  passedRequests?: number;
  passRatePct?: number | null;
  blockRatePct?: number | null;
  totalCostUsd?: number;
  burnRatePerHour?: number;
  projectedMonthlyUsd?: number;
  avgLatencyMs?: number;
  activeServers?: number;
  budgetUsd?: number | null;
  budgetUtilizationPct?: number | null;
  runwayDays?: number | null;
  topServersByCost?: Array<{ server: string; costUsd: number; calls: number }>;
  topToolsByCalls?: Array<{ tool: string; calls: number }>;
  meta?: ChartMeta;
  comparison?: {
    totalRequests: KpiComparison;
    blockedRequests: KpiComparison;
    totalCostUsd: KpiComparison;
    passRatePct: KpiComparison;
  };
  sparklines?: {
    totalCalls: number[];
    blocked: number[];
    costUsd: number[];
  };
  error?: string;
};

export type DashboardInsightsResponse = {
  available?: boolean;
  scope?: string;
  generatedAt?: string;
  windowDays?: number;
  source?: 'measured' | 'llm' | 'deterministic';
  provider?: string;
  model?: string;
  bullets?: string[];
  narrative?: string;
  citations?: Array<{ id: string; text: string }>;
  error?: string;
};

export type AuditActivityMatrix = {
  days: string[];
  hours: number[];
  matrix: number[][];
  maxCount: number;
};

export type AuditHeatmapResponse = {
  available?: boolean;
  windowDays?: number;
  cells?: Array<{ rule: string; tool: string; count: number }>;
  activity?: AuditActivityMatrix;
  meta?: ChartMeta;
  error?: string;
};

export type SecurityResponse = {
  available?: boolean;
  overallScore: number | null;
  activeThreats: number;
  lastScan?: string | null;
  serverReports: Array<{
    name: string;
    scanned?: boolean;
    score: number | null;
    critical: number | null;
    high: number | null;
  }>;
  error?: string;
};

export type HealthResponse = {
  available?: boolean;
  overallStatus?: string;
  status?: string;
  avgLatencyMs?: number | null;
  avgLatency?: number | null;
  serverReports?: Array<{
    name: string;
    latency: number;
    successRate: number | null;
    circuitBreaker: string;
    hasHealthData?: boolean;
  }>;
  atRisk?: string[];
  totalTools?: number;
  error?: string;
};

function liveOrNull<T extends { available?: boolean }>(body: T | null): T | null {
  if (!body || body.available === false) return null;
  return body;
}

export type AiSuggestion = {
  id: string;
  ruleName?: string;
  confidence?: number;
  reason?: string;
  source?: string;
  rule?: Record<string, unknown>;
};

export type PolicyInfo = {
  mode: string;
  rules: string;
  yaml?: string;
  path?: string;
};

export type ActivePolicyRule = {
  name: string;
  action: 'pass' | 'block' | 'flag';
  enabled: boolean;
  description?: string;
  allowCount: number;
  denyCount: number;
  patternCount: number;
  argPatternCount: number;
};

export type ApiError = { error?: string; reason?: string; required?: string };

export type SemanticOutcome = {
  id: string;
  toolName?: string;
  ruleName?: string;
  flagged?: boolean;
  label?: string | null;
  confidence?: number;
  createdAt?: string;
};

export type AiReport = {
  suggestions?: AiSuggestion[];
  report?: Record<string, unknown>;
};

export type SwarmLatest = {
  overall?: boolean;
  gates?: Record<string, unknown>;
  timings?: { totalSec?: number; steps?: Array<{ label: string; elapsedSec: number }> };
  bypasses?: { detected?: number; netNew?: number };
  findings?: Array<{ severity: string; source: string; summary: string }>;
  steps?: Array<{ label: string; ok?: boolean; elapsedSec?: number }>;
  corpus?: { fn?: number; fp?: number; attackBlockRate?: number; benignPassRate?: number };
  parity?: { agreementRate?: number; corpusMismatches?: number };
  commitSha?: string;
  timestamp?: string;
};

export type PlainEnglishReport = {
  verdict?: string;
  headline?: string;
  generatedAt?: string;
  sections?: Array<{
    id: string;
    title: string;
    markdown?: string;
    bullets?: string[];
    items?: Array<{ priority: number; text: string }>;
  }>;
  meta?: Record<string, unknown>;
};

export type TrafficSummary = {
  hasData?: boolean;
  totalCalls?: number;
  totalBlocked?: number;
  windowDays?: number;
  servers?: Array<{
    serverName: string;
    calls: number;
    blocked: number;
    topTools?: Array<{ tool: string; count: number }>;
    topBlockRules?: Array<{ rule: string; count: number; plainEnglish?: string }>;
  }>;
  topBlockRules?: Array<{ rule: string; count: number; plainEnglish?: string }>;
};

export type OnboardingStatus = {
  onboarded: boolean;
  onboardedAt: string | null;
  client: string | null;
  wrapApplied: boolean;
  configsDir: string | null;
  configCount: number;
  hasTraffic: boolean;
  totalCalls: number;
  lastAnalysisAt: string | null;
  lastAnalysisState: string | null;
  dbPath: string;
  commands: { onboard: string; dashboardProxy: string; runAnalysis: string };
};

export type SwarmFigureEntry = {
  name: string;
  title: string;
  category: string;
  url: string;
  generatedAt?: string;
  dataSource?: string;
};

export type VisualsData = {
  generatedAt?: string;
  windowDays?: number;
  meta?: {
    hasTraffic?: boolean;
    hasInstantLearning?: boolean;
    hasSemantic?: boolean;
    swarmSessionLive?: boolean;
    recordCount?: number;
    sparse?: boolean;
    window?: string;
    generatedAt?: string;
    dbPath?: string;
    dataSources?: {
      traffic?: string;
      semantic?: string;
      regression?: string;
      pipeline?: string;
    };
    emptyReasons?: Record<string, string>;
  };
  traffic?: {
    hasData?: boolean;
    totalCalls?: number;
    totalBlocked?: number;
    hourly?: Array<{
      hourStart: string;
      calls: number;
      blocked: number;
      passed: number;
      passRatePct?: number;
      latencyP50Ms?: number;
    }>;
    byServer?: Array<{
      serverName: string;
      calls: number;
      blocked: number;
      costUsd?: number;
      latencyP50Ms?: number;
      latencyP95Ms?: number;
    }>;
    topTools?: Array<{ tool: string; count: number }>;
    topBlockRules?: Array<{ rule: string; count: number; plainEnglish?: string }>;
  };
  instantLearning?: {
    source?: string;
    totalEvents?: number;
    queuedSuggestions?: number;
    blocksPerMinute?: Array<{ t: number; value: number }>;
    ruleToolPairs?: Array<{ rule: string; tool: string; count: number }>;
    classConfidence?: Array<{ class: string; confidence: number }>;
    suggestionEngine?: {
      learningInitialized?: boolean;
      cyclesCompleted?: number;
      baselinesCount?: number;
      recordsAnalyzed?: number;
      suggestionsGenerated?: number;
    };
  };
  semantic?: {
    hasData?: boolean;
    confidenceBuckets?: Array<{ bucket: string; count: number }>;
    labelMix?: Array<{ label: string; count: number }>;
    totals?: Record<string, number>;
  };
  regression?: {
    userServers?: Array<{ serverName: string; status: string; toolCount: number }>;
  };
};

export type ServerRegistryEntry = {
  name: string;
  configPath: string;
  transport: string;
  command?: string;
  wrapped: boolean;
  metrics?: {
    totalCalls: number;
    blocked: number;
    passed: number;
    lastSeen: string | null;
    topTools: Array<{ tool: string; count: number }>;
  };
};

export type FleetInstance = {
  instanceId: string;
  instanceName?: string;
  hostname?: string;
  status?: string;
  region?: string;
  lastHeartbeat?: string;
  totalRequests?: number;
  blockedRequests?: number;
  totalCostUsd?: number;
  avgLatencyMs?: number;
  fleetSource?: string;
  dbPath?: string;
};

export type FleetResponse = {
  available?: boolean;
  source?: string;
  region?: string;
  totalInstances?: number;
  activeInstances?: number;
  totalRequests?: number;
  totalBlocked?: number;
  totalCostUsd?: number;
  instances?: FleetInstance[];
  error?: string;
};

export type AuthStatus = {
  authenticated: boolean;
  authRequired: boolean;
  authConfigured: boolean;
  identity?: string;
  roles?: string[];
  sessionTenantId?: string;
  multiTenantMode?: boolean;
  tenantLocked?: boolean;
  licensed?: boolean;
  tier?: 'community' | 'pro';
  licenseEnforced?: boolean;
  licenseRequired?: boolean;
  openCore?: boolean;
  licenseStatus?: string;
  cloudBillingUrl?: string | null;
  upgradeUrl?: string | null;
  features?: string[];
};

export type WsDashboardMessage = {
  type?: string;
  channel?: string;
  payload?: Record<string, unknown>;
  serverName?: string;
  timestamp?: number;
  blocked?: boolean;
  action?: string;
};

/** API origin: query/env override, else same-origin relative paths (`/api/...`). */
export function resolveApiBase(): string {
  if (typeof window === 'undefined') return '';
  const fromQuery = new URLSearchParams(window.location.search).get('apiBase');
  if (fromQuery) return fromQuery.replace(/\/$/, '');
  const envBase = process.env.NEXT_PUBLIC_MASTYF_AI_API;
  if (envBase) return envBase.replace(/\/$/, '');
  return '';
}

export function getTenantId(): string {
  if (typeof window === 'undefined') return 'default';
  return sessionStorage.getItem(TENANT_STORAGE_KEY) || 'default';
}

export function setTenantId(tenantId: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(TENANT_STORAGE_KEY, tenantId.trim() || 'default');
}

export function buildAuthHeaders(): MastyfAiHeaders {
  const headers: MastyfAiHeaders = { Accept: 'application/json' };
  if (typeof window === 'undefined') return headers;
  const params = new URLSearchParams(window.location.search);
  const apiKey = params.get('apiKey');
  if (apiKey) headers['X-API-Key'] = apiKey;
  const tenant = getTenantId();
  headers['X-Mastyf-Ai-Tenant'] = tenant;
  headers['X-Tenant-Id'] = tenant;
  return headers;
}

export async function mastyfAiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = resolveApiBase();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = path.startsWith('http') ? path : base ? `${base}${normalized}` : normalized;
  return fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      ...buildAuthHeaders(),
      ...(init?.headers as MastyfAiHeaders),
    },
  });
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await mastyfAiFetch('/api/auth/status');
  if (!res.ok) {
    return { authenticated: false, authRequired: true, authConfigured: false };
  }
  return (await res.json()) as AuthStatus;
}

export async function fetchCsrfToken(): Promise<{ csrfToken?: string; csrfEnforced: boolean }> {
  const res = await mastyfAiFetch('/api/auth/csrf');
  if (!res.ok) return { csrfEnforced: false };
  return (await res.json()) as { csrfToken?: string; csrfEnforced: boolean };
}

/** Headers for POST/PUT/DELETE when dashboard CSRF is enforced (cookie session). */
export async function buildMutatingHeaders(
  extra: MastyfAiHeaders = {},
): Promise<MastyfAiHeaders> {
  const headers: MastyfAiHeaders = { 'Content-Type': 'application/json', ...extra };
  const csrf = await fetchCsrfToken();
  if (csrf.csrfToken) headers['X-CSRF-Token'] = csrf.csrfToken;
  return headers;
}

export async function loginDashboard(body: {
  username?: string;
  password?: string;
  api_key?: string;
  csrfToken?: string;
}): Promise<{ success: boolean; error?: string }> {
  const headers: MastyfAiHeaders = { 'Content-Type': 'application/json' };
  if (body.csrfToken) headers['X-CSRF-Token'] = body.csrfToken;
  const res = await mastyfAiFetch('/api/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username: body.username,
      password: body.password,
      api_key: body.api_key,
    }),
  });
  const data = (await res.json()) as { success?: boolean; error?: string };
  return { success: !!data.success && res.ok, error: data.error };
}

export async function logoutDashboard(): Promise<void> {
  await mastyfAiFetch('/api/logout', { method: 'POST' });
}

export async function fetchTenantContext(): Promise<{
  tenantId: string;
  multiTenantMode: boolean;
} | null> {
  const res = await mastyfAiFetch('/api/admin/tenant');
  if (!res.ok) return null;
  const data = (await res.json()) as { tenantId?: string; multiTenantMode?: boolean };
  return {
    tenantId: data.tenantId || 'default',
    multiTenantMode: !!data.multiTenantMode,
  };
}

function withWindowRegionQuery(
  window: string | number,
  region?: string,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({ window: toWindowQueryParam(window) });
  if (region) params.set('region', region);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  return params.toString();
}

export async function fetchDashboardRegions(): Promise<{ regions: string[] } | null> {
  const res = await mastyfAiFetch('/api/dashboard/regions');
  if (!res.ok) return null;
  const body = (await res.json()) as { regions?: string[]; available?: boolean };
  if (body.available === false) return null;
  return { regions: body.regions ?? [] };
}

export async function fetchAggregateMetrics(window: string | number = '7d', region?: string): Promise<AggregateMetrics | null> {
  const q = withWindowRegionQuery(window, region);
  const res = await mastyfAiFetch(`/api/aggregate/metrics?${q}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as AggregateMetrics);
}

export async function fetchAudit(opts?: {
  limit?: number;
  action?: string;
  server?: string;
  windowDays?: number;
  windowParam?: string;
  region?: string;
}): Promise<AuditResponse | null> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.action) params.set('action', opts.action);
  if (opts?.server) params.set('server', opts.server);
  const windowQ = opts?.windowParam ?? opts?.windowDays;
  if (windowQ != null && (typeof windowQ === 'string' || Number.isFinite(windowQ))) {
    params.set('window', toWindowQueryParam(windowQ));
  }
  if (opts?.region) params.set('region', opts.region);
  const q = params.toString();
  const res = await mastyfAiFetch(`/api/aggregate/audit${q ? `?${q}` : ''}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as AuditResponse & { available?: boolean });
}

export async function fetchCost(window: string | number = '7d', region?: string): Promise<CostResponse | null> {
  const res = await mastyfAiFetch(`/api/cost?${withWindowRegionQuery(window, region)}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as CostResponse);
}

export async function fetchCostBreakdown(window: string | number = 7): Promise<CostBreakdownResponse | null> {
  const res = await mastyfAiFetch(`/api/cost/breakdown?window=${toWindowQueryParam(window)}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as CostBreakdownResponse);
}

export type CostRecommendation = {
  ruleName: string;
  description: string;
  reason: string;
  confidence: number;
  estimatedSavingsUsd: number;
  action: string;
};

export type CostRecommendationsResponse = {
  available?: boolean;
  windowDays?: number;
  recommendations?: CostRecommendation[];
  error?: string;
};

export async function fetchCostRecommendations(
  window: string | number = '7d',
): Promise<CostRecommendationsResponse | null> {
  const res = await mastyfAiFetch(`/api/cost/recommendations?window=${toWindowQueryParam(window)}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as CostRecommendationsResponse);
}

export async function fetchCostTimeseries(
  window: string | number = '7d',
  granularity: 'hour' | 'day' = 'day',
  region?: string,
): Promise<CostTimeseriesResponse | null> {
  const q = withWindowRegionQuery(window, region, { granularity });
  const res = await mastyfAiFetch(`/api/cost/timeseries?${q}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as CostTimeseriesResponse);
}

export async function fetchExecutiveSummary(
  window: string | number = '7d',
  region?: string,
): Promise<ExecutiveSummaryResponse | null> {
  const res = await mastyfAiFetch(`/api/dashboard/executive-summary?${withWindowRegionQuery(window, region)}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as ExecutiveSummaryResponse);
}

export async function fetchDashboardInsights(
  scope: 'overview' | 'cost' | 'security' | 'audit' | 'ai',
  window: string | number = '7d',
): Promise<DashboardInsightsResponse | null> {
  const res = await mastyfAiFetch(`/api/dashboard/insights?scope=${scope}&window=${toWindowQueryParam(window)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as DashboardInsightsResponse;
  if (body.available === false && !body.bullets?.length) return null;
  return body;
}

export async function trackAdvancedAnalyticsEvent(event: {
  feature: string;
  metric?: string;
  confidence?: 'high' | 'medium' | 'low';
  value?: number | string;
}): Promise<void> {
  const headers = await buildMutatingHeaders();
  try {
    await mastyfAiFetch('/api/dashboard/analytics/telemetry', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...event,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    /* best-effort analytics only */
  }
}

export async function downloadInsightsBriefing(
  scope: 'overview' | 'cost' | 'security' | 'audit' | 'ai',
  window: string | number = '7d',
): Promise<{ ok: boolean; error?: string }> {
  const windowQ = toWindowQueryParam(window);
  const res = await mastyfAiFetch(`/api/dashboard/insights/export?scope=${scope}&window=${windowQ}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error || `Download failed (HTTP ${res.status})` };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mastyf-ai-briefing-${scope}-${formatDownloadWindowSuffix(window)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true };
}

export type McpHealthReportResponse = {
  available?: boolean;
  generatedAt?: string;
  windowDays?: number;
  verdict?: 'healthy' | 'attention' | 'critical';
  headline?: string;
  executiveSummary?: string[];
  servers?: Array<{
    name: string;
    latencyMs: number | null;
    successRatePct: number | null;
    toolCount: number;
    circuitBreaker: string;
    totalCalls: number;
    blockedCalls: number;
    summary: string;
  }>;
  performance?: {
    avgLatencyMs: number | null;
    passRatePct: number;
    totalRequests: number;
    blockedRequests: number;
    totalCostUsd: number;
  };
  securityPosture?: {
    policyMode: string;
    ruleSummary: string;
    topBlockRules: string[];
  };
  recommendations?: Array<{ priority: number; action: string }>;
  markdown?: string;
  citations?: Array<{ id: string; source: string; text: string }>;
  source?: 'measured' | 'llm';
  provider?: string;
  model?: string;
  narrative?: string;
  error?: string;
};

async function parseApiErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error?.includes('Dashboard API disabled')) {
      return (
        'Dashboard REST API is disabled. From the repo run: ' +
        'pnpm build:mastyf-ai && pnpm dashboard:proxy -- mastyf-ai-configs/filesystem.json ' +
        '(sets MASTYF_AI_CI_BYPASS_LICENSE). Open http://localhost:4000/ — not a separate Next dev port unless you use ?apiBase=http://localhost:4000'
      );
    }
    if (body?.error) return body.error;
  } catch {
    /* non-JSON 404 (e.g. Next.js dev without apiBase) */
  }
  if (res.status === 404 && typeof window !== 'undefined') {
    const base = resolveApiBase();
    if (!base && !window.location.port.includes('4000')) {
      return (
        `${fallback} You may be on the wrong origin (${window.location.origin}). ` +
        'Use http://localhost:4000/ or add ?apiBase=http://localhost:4000'
      );
    }
  }
  return fallback;
}

export async function fetchMcpHealthReport(
  window: string | number = '7d',
  useLlm = false,
): Promise<{ report: McpHealthReportResponse | null; error?: string }> {
  const res = await mastyfAiFetch(
    `/api/reports/mcp-health?window=${toWindowQueryParam(window)}&useLlm=${useLlm ? 'true' : 'false'}`,
  );
  if (res.status === 404) {
    return {
      report: null,
      error: await parseApiErrorMessage(
        res,
        'Health report API not found — run `pnpm build:mastyf-ai`, restart the proxy with DASHBOARD_ENABLED=true, then refresh.',
      ),
    };
  }
  let body: McpHealthReportResponse;
  try {
    body = (await res.json()) as McpHealthReportResponse;
  } catch {
    return { report: null, error: `Invalid response (HTTP ${res.status})` };
  }
  if (!res.ok) {
    return { report: null, error: body.error || `HTTP ${res.status}` };
  }
  if (body.available === false) {
    return {
      report: null,
      error:
        body.error
        || 'Report unavailable — ensure the proxy is running with DASHBOARD_ENABLED=true and history.db is writable.',
    };
  }
  return { report: body };
}

export async function downloadMcpHealthReport(
  window: string | number = '7d',
  useLlm = false,
): Promise<{ ok: boolean; error?: string }> {
  const windowQ = toWindowQueryParam(window);
  const res = await mastyfAiFetch(
    `/api/reports/mcp-health/download?window=${windowQ}&useLlm=${useLlm ? 'true' : 'false'}`,
  );
  if (!res.ok) {
    return { ok: false, error: `Download failed (HTTP ${res.status})` };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `mastyf-ai-mcp-health-${date}.md`;
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true };
}

export async function fetchFullAnalysis(
  window: string | number = '7d',
  useLlm = true,
): Promise<{ analysis: MastyfAiFullAnalysisResponse | null; error?: string }> {
  const res = await mastyfAiFetch(
    `/api/analysis/full?window=${toWindowQueryParam(window)}&useLlm=${useLlm ? 'true' : 'false'}`,
  );
  if (res.status === 404) {
    return {
      analysis: null,
      error: await parseApiErrorMessage(
        res,
        'Full analysis API not found — run `pnpm build:mastyf-ai`, restart the proxy with DASHBOARD_ENABLED=true, then refresh.',
      ),
    };
  }
  let body: MastyfAiFullAnalysisResponse;
  try {
    body = (await res.json()) as MastyfAiFullAnalysisResponse;
  } catch {
    return { analysis: null, error: `Invalid response (HTTP ${res.status})` };
  }
  if (!res.ok) {
    return { analysis: null, error: body.error || `HTTP ${res.status}` };
  }
  if (body.available === false) {
    return {
      analysis: null,
      error:
        body.error
        || 'Analysis unavailable — ensure the proxy is running with DASHBOARD_ENABLED=true and history.db has traffic.',
    };
  }
  return { analysis: body };
}

export async function downloadFullAnalysis(
  window: string | number = '7d',
  useLlm = true,
): Promise<{ ok: boolean; error?: string }> {
  const windowQ = toWindowQueryParam(window);
  const res = await mastyfAiFetch(
    `/api/analysis/full/download?window=${windowQ}&useLlm=${useLlm ? 'true' : 'false'}`,
  );
  if (!res.ok) {
    return { ok: false, error: `Download failed (HTTP ${res.status})` };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `mastyf-ai-full-analysis-${date}.md`;
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true };
}

export async function fetchAuditHeatmap(
  window: string | number = 7,
  region?: string,
): Promise<AuditHeatmapResponse | null> {
  const res = await mastyfAiFetch(`/api/audit/heatmap?${withWindowRegionQuery(window, region)}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as AuditHeatmapResponse);
}

export async function fetchSecurity(): Promise<SecurityResponse | null> {
  const res = await mastyfAiFetch('/api/security');
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as SecurityResponse);
}

export async function fetchHealth(): Promise<HealthResponse | null> {
  const res = await mastyfAiFetch('/api/health');
  if (!res.ok) return null;
  const data = liveOrNull((await res.json()) as HealthResponse);
  if (!data) return null;
  return {
    ...data,
    avgLatencyMs: data.avgLatencyMs ?? data.avgLatency ?? null,
    overallStatus: data.overallStatus || data.status || 'unknown',
    serverReports: (data.serverReports ?? []).map((s) => ({
      ...s,
      latency: s.latency ?? 0,
      successRate: s.successRate ?? null,
      circuitBreaker: String(s.circuitBreaker ?? 'closed').toUpperCase(),
      tools: (s as { tools?: number; toolCount?: number }).tools
        ?? (s as { tools?: number; toolCount?: number }).toolCount
        ?? 0,
    })),
  };
}

export async function fetchFleetInstances(): Promise<FleetResponse | null> {
  const res = await mastyfAiFetch('/api/instances');
  if (!res.ok) return null;
  const data = await res.json();
  if (Array.isArray(data)) {
    return { available: true, source: 'legacy', instances: data as FleetInstance[] };
  }
  return liveOrNull(data as FleetResponse);
}

export async function fetchAiSuggestions(): Promise<AiSuggestion[]> {
  const res = await mastyfAiFetch('/api/ai/suggestions');
  if (!res.ok) return [];
  const body = (await res.json()) as { suggestions?: AiSuggestion[] };
  return body.suggestions || [];
}

export async function fetchPolicy(): Promise<PolicyInfo | null> {
  const res = await mastyfAiFetch('/api/policy');
  if (!res.ok) return null;
  return (await res.json()) as PolicyInfo;
}

export async function fetchPolicyRules(): Promise<ActivePolicyRule[]> {
  const res = await mastyfAiFetch('/api/policy/rules');
  if (!res.ok) return [];
  const body = (await res.json()) as { rules?: ActivePolicyRule[] };
  return body.rules ?? [];
}

export async function togglePolicyRule(
  name: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string; details?: string; warning?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy/rules', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name, enabled }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
    return { ok: false, error: data.error || res.statusText, details: data.details };
  }
  const data = (await res.json().catch(() => ({}))) as { warning?: string };
  return { ok: true, warning: data.warning };
}

export async function removePolicyRule(
  name: string,
): Promise<{ ok: boolean; error?: string; details?: string; warning?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy/rules', {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
    return { ok: false, error: data.error || res.statusText, details: data.details };
  }
  const data = (await res.json().catch(() => ({}))) as { warning?: string };
  return { ok: true, warning: data.warning };
}

export async function testPolicy(payload: {
  tool: string;
  arguments: Record<string, unknown>;
  server?: string;
}): Promise<Record<string, unknown> | null> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy/test', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tool: payload.tool,
      arguments: payload.arguments,
      server: payload.server || 'dashboard-test',
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchPolicyCopilot(goal: string, availableTools?: string[]): Promise<Record<string, unknown> | null> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy/copilot', {
    method: 'POST',
    headers,
    body: JSON.stringify({ goal, availableTools }),
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchPolicyCounterfactual(
  rule?: Record<string, unknown>,
  windowDays = 14,
): Promise<Record<string, unknown> | null> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy/copilot/counterfactual', {
    method: 'POST',
    headers,
    body: JSON.stringify({ rule, windowDays }),
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchActiveLearningReport(): Promise<Record<string, unknown> | null> {
  const res = await mastyfAiFetch('/api/learning/semantic/active-learning');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchAgentAbuseScores(window: string | number = '7d'): Promise<Record<string, unknown> | null> {
  const res = await mastyfAiFetch(`/api/dashboard/agent-abuse?window=${toWindowQueryParam(window)}`);
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchToolIntegrityReport(): Promise<Record<string, unknown> | null> {
  const res = await mastyfAiFetch('/api/security-swarm/tool-integrity');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchShadowRedTeamReport(): Promise<Record<string, unknown> | null> {
  const res = await mastyfAiFetch('/api/security-swarm/shadow-red-team');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchSupplyChainGraph(): Promise<Record<string, unknown> | null> {
  const res = await mastyfAiFetch('/api/security-swarm/supply-chain');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchSignatureHints(): Promise<Record<string, unknown> | null> {
  const res = await mastyfAiFetch('/api/fleet/signature-hints');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export type TribunalDebateSummary = {
  recordId?: string;
  toolName?: string;
  serverName?: string;
  uncertaintyScore?: number;
  verdict?: {
    recommendedLabel?: 'true_positive' | 'false_positive' | 'needs_review';
    unanimous?: boolean;
    confidence?: number;
    dissent?: string;
  };
};

export type TribunalReport = {
  generatedAt?: string;
  queueSize?: number;
  debatedCount?: number;
  batchLimit?: number;
  eligibleTotal?: number;
  remainingEligible?: number;
  debates?: TribunalDebateSummary[];
  quorumMet?: boolean;
  autoLabelsApplied?: number;
};

export type TribunalJobStatus = {
  jobId: string;
  tenantId: string;
  state: 'idle' | 'running' | 'done' | 'failed';
  phase: string;
  phaseLabel: string;
  progressPct: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  logTail: string;
  pid: number | null;
  debatedCount?: number;
  remainingEligible?: number;
};

export type TribunalStatusResponse = {
  job: TribunalJobStatus;
  report: TribunalReport | null;
  queue: {
    batchLimit: number;
    eligibleTotal: number;
    nextBatchSize: number;
    remainingEligible: number;
  };
};

export async function fetchTribunalStatus(
  limit: number = TRIBUNAL_BATCH_LIMIT,
): Promise<TribunalStatusResponse | null> {
  const res = await mastyfAiFetch(
    `/api/learning/semantic/tribunal?limit=${limit}&peek=true`,
  );
  if (!res.ok) return null;
  return (await res.json()) as TribunalStatusResponse;
}

export async function runTribunalBatch(
  limit: number = TRIBUNAL_BATCH_LIMIT,
): Promise<{ ok: boolean; error?: string; jobId?: string; startedAt?: string }> {
  const res = await mastyfAiFetch('/api/learning/semantic/tribunal/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit, useLlm: false }),
  });
  const body = (await res.json()) as { error?: string; jobId?: string; startedAt?: string };
  return { ok: res.ok, error: body.error, jobId: body.jobId, startedAt: body.startedAt };
}

/** @deprecated Use fetchTribunalStatus + runTribunalBatch */
export async function fetchTribunalReport(
  limit: number = TRIBUNAL_BATCH_LIMIT,
): Promise<TribunalReport | null> {
  const status = await fetchTribunalStatus(limit);
  return status?.report ?? null;
}

export async function fetchComplianceReport(window: string | number = '7d'): Promise<Record<string, unknown> | null> {
  const res = await mastyfAiFetch(`/api/ai/compliance/report?window=${toWindowQueryParam(window)}&useLlm=false`);
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchTenantModelReadiness(): Promise<TenantModelReadinessResponse | null> {
  const res = await mastyfAiFetch('/api/ai/tenant-model/readiness');
  if (!res.ok) return null;
  return (await res.json()) as TenantModelReadinessResponse;
}

export type TenantModelReadinessResponse = {
  tenantId: string;
  ready: boolean;
  labeledCount: number;
  minRequired: number;
  modelName: string;
  exportPath: string;
  message: string;
  routing?: { model: string | null; source: 'explicit' | 'tenant' | 'default' };
};

export type TenantModelExportResponse = {
  action: 'export';
  readiness: TenantModelReadinessResponse;
  manifest: { modelName: string; rowCount: number; ollamaCreateHint: string };
  exportPath: string;
  modelfilePath: string;
  manifestPath: string;
  rowsExported: number;
  fewShotExamples: number;
  envHint: string;
};

export type TenantModelTrainJobResponse = {
  jobId: string;
  status: string;
  readiness?: TenantModelReadinessResponse;
  error?: string;
};

export type TenantModelTrainStatus = {
  jobId: string;
  tenantId: string;
  state: 'idle' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  logTail: string;
};

export async function fetchTenantModelTrain(
  action: 'export' | 'train',
): Promise<TenantModelExportResponse | TenantModelTrainJobResponse | null> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/ai/tenant-model/train', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Train API failed (${res.status})`);
  }
  return (await res.json()) as TenantModelExportResponse | TenantModelTrainJobResponse;
}

export async function fetchTenantModelTrainStatus(): Promise<TenantModelTrainStatus | null> {
  const res = await mastyfAiFetch('/api/ai/tenant-model/train/status');
  if (!res.ok) return null;
  return (await res.json()) as TenantModelTrainStatus;
}

export type InvestigateIncidentResult = {
  investigation: Record<string, unknown> | null;
  error?: string;
};

export async function investigateIncident(triggerId: string): Promise<InvestigateIncidentResult> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/incidents/investigate', {
    method: 'POST',
    headers,
    body: JSON.stringify({ triggerId, useLlm: false }),
  });
  if (!res.ok) {
    let message = `Investigation request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error === 'Not found') {
        message =
          'Incident API is unavailable on this dashboard host. Restart the Mastyf AI proxy after `pnpm build` so it loads the latest dashboard routes.';
      } else if (body.error === 'Trigger record not found') {
        message =
          'No investigation anchor found for this trigger. Try refreshing Threat Lab candidates, or investigate from a semantic audit record in AI Learning.';
      } else if (body.error) {
        message = body.error;
      }
    } catch {
      /* ignore parse errors */
    }
    return { investigation: null, error: message };
  }
  return { investigation: (await res.json()) as Record<string, unknown> };
}

export type SuggestionActionResult = { ok: boolean; error?: string };

export async function acceptSuggestion(suggestion: AiSuggestion): Promise<SuggestionActionResult> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy/suggestions/accept', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      suggestionId: suggestion.id || suggestion.ruleName,
      ruleName: suggestion.ruleName || suggestion.id,
      source: suggestion.source || 'attack',
      confidence: suggestion.confidence ?? 0.8,
      rule: suggestion.rule,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      reason?: string;
      blockers?: string[];
    };
    if (data.error === 'autopilot_safety_blocked') {
      const blockers = Array.isArray(data.blockers) ? data.blockers.join('; ') : '';
      return {
        ok: false,
        error: blockers ? `Safety blocked: ${blockers}` : 'Autopilot safety blocked this suggestion',
      };
    }
    return { ok: false, error: data.reason || data.error || `Accept failed (HTTP ${res.status})` };
  }
  return { ok: true };
}

export async function rejectSuggestion(suggestion: AiSuggestion): Promise<SuggestionActionResult> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy/suggestions/reject', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      suggestionId: suggestion.id || suggestion.ruleName,
      ruleName: suggestion.ruleName || suggestion.id,
      source: suggestion.source || 'attack',
      confidence: suggestion.confidence ?? 0.5,
    }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
    return { ok: false, error: data.reason || data.error || `Reject failed (HTTP ${res.status})` };
  }
  return { ok: true };
}

export async function reloadPolicy(): Promise<boolean> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy/reload', { method: 'POST', headers });
  return res.ok;
}

export async function savePolicy(yaml: string): Promise<{ ok: boolean; error?: string; details?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ yaml }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
    return {
      ok: false,
      error: data.error || res.statusText,
      details: data.details,
    };
  }
  return { ok: true };
}

export type SwarmJobStatus = {
  jobId: string;
  state: 'idle' | 'running' | 'done' | 'failed';
  phase: string;
  phaseLabel: string;
  progressPct: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  analysisPath: string;
  logTail: string;
  hasRun?: boolean;
  sessionArtifactsVisible?: boolean;
};

export async function runSecuritySwarm(opts?: {
  full?: boolean;
}): Promise<{ ok: boolean; jobId?: string; startedAt?: string; error?: string } | null> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/security-swarm/run', {
    method: 'POST',
    headers,
    body: JSON.stringify({ full: !!opts?.full }),
  });
  if (res.status === 409) {
    const body = (await res.json()) as { error?: string; jobId?: string };
    return { ok: false, error: body.error || 'Analysis already running', jobId: body.jobId };
  }
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  const body = (await res.json()) as { jobId?: string; startedAt?: string };
  return { ok: true, jobId: body.jobId, startedAt: body.startedAt };
}

export async function fetchSwarmStatus(): Promise<SwarmJobStatus | null> {
  const res = await mastyfAiFetch('/api/security-swarm/status');
  if (!res.ok) return null;
  return (await res.json()) as SwarmJobStatus;
}

export type SwarmJobLogResponse = {
  available?: boolean;
  log?: string;
  steps?: unknown[];
  hasLog?: boolean;
  error?: string;
};

export async function fetchSwarmJobLog(): Promise<SwarmJobLogResponse | null> {
  const res = await mastyfAiFetch('/api/security-swarm/job-log');
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as SwarmJobLogResponse);
}

export type SoarPlaybook = {
  id: string;
  name: string;
  description?: string;
  triggers?: string[];
  actions?: string[];
};

export async function fetchSoarPlaybooks(): Promise<{
  enabled: boolean;
  playbooks: SoarPlaybook[];
} | null> {
  const res = await mastyfAiFetch('/api/soar/playbooks');
  if (!res.ok) return null;
  const body = (await res.json()) as { enabled?: boolean; playbooks?: SoarPlaybook[] };
  return { enabled: !!body.enabled, playbooks: body.playbooks ?? [] };
}

export async function fetchSwarmReportPreview(): Promise<string | null> {
  const res = await mastyfAiFetch('/api/security-swarm/report');
  if (!res.ok) return null;
  return res.text();
}

export async function downloadSwarmReport(): Promise<{ ok: boolean; error?: string }> {
  const res = await mastyfAiFetch('/api/security-swarm/report/download');
  if (!res.ok) {
    return { ok: false, error: `Download failed (HTTP ${res.status})` };
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mastyf-ai-swarm-analysis.txt';
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true };
}

export async function fetchAiReport(): Promise<AiReport | null> {
  const res = await mastyfAiFetch('/api/ai/report');
  if (!res.ok) return null;
  return (await res.json()) as AiReport;
}

export async function fetchAiState(): Promise<{
  initialized: boolean;
  state: Record<string, unknown> | null;
} | null> {
  const res = await mastyfAiFetch('/api/ai/state');
  if (!res.ok) return null;
  const body = (await res.json()) as {
    available?: boolean;
    initialized?: boolean;
    state?: Record<string, unknown> | null;
  };
  if (body.available === false) {
    return { initialized: false, state: null };
  }
  return {
    initialized: !!body.initialized,
    state: body.state ?? null,
  };
}

export async function fetchAiBaselines(): Promise<unknown[]> {
  const res = await mastyfAiFetch('/api/ai/baselines');
  if (!res.ok) return [];
  const body = (await res.json()) as { baselines?: unknown[] };
  return body.baselines || [];
}

export type ThreatIntelEntry = {
  id: string;
  source: 'OSV' | 'NVD' | 'GitHub' | 'custom';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  remediation?: string;
  publishedAt?: string;
  firstSeenAt?: string;
  affectedPackage?: string;
};

export type ThreatIntelStatus = {
  threats: number;
  knownIds: string[];
  entries: ThreatIntelEntry[];
  updated: string | null;
  lastPollAt: string | null;
  pollingActive: boolean;
  pollingDisabled: boolean;
  suppressed?: number;
};

export type QuarantineRecord = {
  id: string;
  source: 'OSV' | 'NVD' | 'GitHub' | 'custom';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  remediation: string;
  publishedAt: string;
  quarantinedAt: string;
  operator?: string;
  note?: string;
  appliedRuleName?: string;
  policyPath?: string;
  affectedPackage?: string;
  affectedPattern?: string;
  signature?: string;
};

export type QuarantineTriggeredDetail = {
  kind: 'proxy_block' | 'semantic_flag' | 'threat_intel';
  title: string;
  ruleName?: string;
  reason?: string;
  toolName?: string;
  serverName?: string;
  timestamp?: string;
  patterns?: string[];
  severity?: string;
  signature?: string;
  affectedPackage?: string;
  affectedPattern?: string;
  semanticLabel?: string | null;
  semanticConfidence?: number;
  argumentsSnapshot?: Record<string, unknown>;
};

export type QuarantinePolicyDetail = {
  source: 'monitor' | 'intel';
  id: string;
  threatKey?: string;
  policyPath?: string;
  quarantine: {
    quarantinedAt: string;
    operator?: string;
    note?: string;
    appliedRuleName?: string;
    enforcementStatus?: string;
    enforcementDetail?: string;
    sourceKind?: string;
  };
  triggered: QuarantineTriggeredDetail | null;
  appliedRule: Record<string, unknown> | null;
  suggestedRule: Record<string, unknown> | null;
};

export async function fetchIntelQuarantinePolicy(
  row: Pick<QuarantineRecord, 'id'> & Partial<QuarantineRecord>,
  days = 30,
): Promise<{ detail: QuarantinePolicyDetail | null; error?: string }> {
  const headers = await buildMutatingHeaders({ 'Content-Type': 'application/json' });
  const res = await mastyfAiFetch('/api/ai/threats/quarantine/policy', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: row.id, days, record: row }),
  });
  if (res.status === 404) {
    return { detail: null, error: 'Quarantined threat not found' };
  }
  if (!res.ok) {
    return { detail: null, error: await parseApiError(res) };
  }
  return { detail: (await res.json()) as QuarantinePolicyDetail };
}

export async function fetchMonitorQuarantinePolicy(
  row: Pick<SecurityMonitorQuarantineRecord, 'threatKey' | 'id'> &
    Partial<SecurityMonitorQuarantineRecord>,
  days = 30,
): Promise<{ detail: QuarantinePolicyDetail | null; error?: string }> {
  const headers = await buildMutatingHeaders({ 'Content-Type': 'application/json' });
  const res = await mastyfAiFetch('/api/security/threats/quarantine/policy', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      threatKey: row.threatKey,
      id: row.id,
      days,
      record: row,
    }),
  });
  if (res.status === 404) {
    return { detail: null, error: 'Quarantined monitor threat not found' };
  }
  if (!res.ok) {
    return { detail: null, error: await parseApiError(res) };
  }
  return { detail: (await res.json()) as QuarantinePolicyDetail };
}

export async function fetchAiThreats(): Promise<ThreatIntelStatus | null> {
  const res = await mastyfAiFetch('/api/ai/threats');
  if (!res.ok) return null;
  return (await res.json()) as ThreatIntelStatus;
}

export async function pollAiThreats(): Promise<{ ok: boolean; status?: ThreatIntelStatus; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/ai/threats/poll', { method: 'POST', headers, body: '{}' });
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  const status = (await res.json()) as ThreatIntelStatus;
  return { ok: true, status };
}

export async function fetchQuarantinedThreats(days = 30): Promise<QuarantineRecord[]> {
  const res = await mastyfAiFetch(`/api/ai/threats/quarantined?days=${days}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { entries?: QuarantineRecord[] };
  return body.entries ?? [];
}

export async function quarantineThreatIntel(
  id: string,
  note?: string,
): Promise<{ ok: boolean; error?: string; appliedRuleName?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/ai/threats/quarantine', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, note }),
  });
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  const body = (await res.json()) as { appliedRuleName?: string };
  return { ok: true, appliedRuleName: body.appliedRuleName };
}

export async function dismissThreatIntel(id: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/ai/threats/dismiss', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id, note }),
  });
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  return { ok: true };
}

export async function restoreThreatIntel(id: string): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/ai/threats/restore', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id }),
  });
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  return { ok: true };
}

export async function parseApiError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiError;
    return body.reason || body.error || body.required || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function rollbackAiLearning(): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/ai/rollback', { method: 'POST', headers, body: '{}' });
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  return { ok: true };
}

export type SemanticOutcomesResponse = {
  records: SemanticOutcome[];
  meta?: {
    tenantId?: string;
    asyncEnabled?: boolean;
    windowDays?: number;
    defaultTenantRecords?: number;
    hint?: string;
  };
};

export async function fetchSemanticOutcomes(): Promise<SemanticOutcomesResponse> {
  const res = await mastyfAiFetch('/api/learning/semantic/outcomes');
  if (!res.ok) {
    return {
      records: [],
      meta: { hint: 'Semantic outcomes API unavailable — check dashboard auth.' },
    };
  }
  const body = (await res.json()) as {
    records?: Array<Record<string, unknown>>;
    meta?: SemanticOutcomesResponse['meta'];
  };
  const records = (body.records || []).map((r) => {
    const sync = r.syncDecision as { blockRule?: string; rule?: string } | undefined;
    const sem = r.semanticAudit as { suspicious?: boolean; confidence?: number } | undefined;
    return {
      id: String(r.id ?? ''),
      toolName: String(r.toolName ?? ''),
      ruleName: sync?.blockRule || sync?.rule || String(r.ruleName ?? ''),
      label: (r.label as SemanticOutcome['label']) ?? null,
      flagged: !!sem?.suspicious,
      confidence: typeof sem?.confidence === 'number' ? sem.confidence : undefined,
      createdAt: String(r.timestamp ?? ''),
    };
  });
  return { records, meta: body.meta };
}

export async function labelSemanticOutcome(payload: {
  semanticAuditId: string;
  label: 'true_positive' | 'false_positive' | 'ignored';
  ruleName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/learning/label', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  return { ok: true };
}

export async function rejectFp(payload: {
  rule: string;
  pattern: string;
}): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/policy/fp/reject', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  return { ok: true };
}

export async function fetchAdminAuditTrail(): Promise<unknown[]> {
  const res = await mastyfAiFetch('/api/admin/audit-trail');
  if (!res.ok) return [];
  const body = (await res.json()) as { entries?: unknown[] };
  return body.entries || [];
}

export async function fetchLogs(): Promise<string[]> {
  const res = await mastyfAiFetch('/api/logs');
  if (!res.ok) return [];
  const body = (await res.json()) as { logs?: string[] };
  return body.logs || [];
}

export async function fetchSwarmLatest(): Promise<SwarmLatest | null> {
  const res = await mastyfAiFetch('/api/security-swarm/latest');
  if (!res.ok) return null;
  return (await res.json()) as SwarmLatest;
}

export async function fetchSwarmFigures(): Promise<SwarmFigureEntry[]> {
  const res = await mastyfAiFetch('/api/security-swarm/figures');
  if (!res.ok) return [];
  const body = (await res.json()) as { figures?: SwarmFigureEntry[] };
  return body.figures || [];
}

export type VisualsLiveFetchResult =
  | { ok: true; data: VisualsData }
  | { ok: false; status: number; message: string };

export async function fetchVisualsLive(window: string | number = '7d', region?: string): Promise<VisualsLiveFetchResult> {
  const res = await mastyfAiFetch(`/api/visuals/live?${withWindowRegionQuery(window, region)}`);
  if (!res.ok) {
    let message =
      res.status === 404
        ? 'Dashboard API is outdated — run `pnpm build` and restart `pnpm dashboard:proxy`.'
        : `Visuals API error (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON body */
    }
    return { ok: false, status: res.status, message };
  }
  const body = (await res.json()) as VisualsData & { available?: boolean; error?: string };
  if (body.available === false) {
    return { ok: false, status: 503, message: body.error || 'No live visuals data' };
  }
  const { available: _a, error: _e, ...data } = body;
  return { ok: true, data: data as VisualsData };
}

export async function fetchSwarmSummary(): Promise<string | null> {
  const res = await mastyfAiFetch('/api/security-swarm/summary');
  if (!res.ok) return null;
  return res.text();
}

export type ThreatLabCandidate = {
  id: string;
  fingerprint: string;
  attackClass: string;
  hypothesis: string;
  confidence: number;
  path?: string;
  branch?: string;
  reviewStatus?: 'pending' | 'accepted' | 'rejected';
  policyRule?: Record<string, unknown>;
  corpusCandidate?: Record<string, unknown>;
  provenance?: {
    source?: string;
    llmUsed?: boolean;
    inputFingerprint?: string;
  };
  validation?: {
    ok?: boolean;
    errors?: string[];
    replayBlocked?: boolean;
  };
  advWriteSkipped?: string;
};

export type ThreatDiscoveryJobStatus = {
  jobId: string;
  kind: 'threat-lab' | 'auto-research';
  tenantId: string;
  state: 'idle' | 'running' | 'done' | 'failed';
  phase: string;
  phaseLabel: string;
  progressPct: number;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  logTail: string;
  pid: number | null;
};

export type ThreatDiscoveryStatus = {
  timestamp: string;
  license: { swarmFeature: boolean; bypass: boolean };
  features: {
    threatLabEnabled: boolean;
    threatLabMode: 'reactive' | 'proactive';
    threatLabMax: number;
    threatLabSemantic: boolean;
    autoResearchEnabled: boolean;
    autoResearchConfig: Record<string, unknown>;
  };
  llm: { ok: boolean; reason?: string; model?: string };
  pipeline: {
    queued: number;
    writesThisHour: number;
    maxPerHour: number;
    debounceMs: number;
    enabled: boolean;
    sources: { semantic: boolean; blocks: boolean; threatIntel: boolean };
  };
  processedFingerprints: number;
  threatLab: {
    manifest: {
      timestamp?: string;
      count?: number;
      mode?: string;
      llmModel?: string;
      llmUsed?: boolean;
      skipped?: string;
      runNote?: string;
      candidates?: ThreatLabCandidate[];
    } | null;
    stats: {
      total: number;
      pending: number;
      accepted: number;
      rejected: number;
      byReviewStatus: Record<string, number>;
      bySource: Record<string, number>;
      byAttackClass: Record<string, number>;
      avgConfidence: number;
      confidenceBuckets: { bucket: string; count: number }[];
    };
  };
  autoCorpus: {
    manifest: {
      timestamp: string;
      count: number;
      entries: AutoCorpusEntry[];
    } | null;
    stats: {
      total: number;
      last24h: number;
      bySource: Record<string, number>;
      byAttackClass: Record<string, number>;
      timeline: { advId: string; timestamp: string; source: string; confidence: number }[];
    };
  };
  jobs: {
    threatLab: ThreatDiscoveryJobStatus;
    autoResearch: ThreatDiscoveryJobStatus & {
      parsed?: {
        written: number;
        attempted: number;
        skips: {
          duplicate: number;
          belowMinConfidence: number;
          replayFailed: number;
          llmUnavailable: number;
          llmDiscoveryNull: number;
          other: number;
        };
        summaryLine: string | null;
      };
    };
  };
  provenance?: {
    strictLive: boolean;
    sessionActive: boolean;
    legacyAllowed: boolean;
    source: 'session-swarm' | 'legacy-swarm' | 'none';
  };
};

export type ThreatAutomationSummary = {
  timestamp: string;
  scheduler: {
    running: boolean;
    startedAt: string | null;
    stoppedAt: string | null;
    lastRunAt: string | null;
    lastRunStatus: 'success' | 'failed' | null;
    lastRunError: string | null;
    nextRunAt: string | null;
    intervalMs: number;
    totalRuns: number;
    totalErrors: number;
    tenantId: string;
    pid: number | null;
    message?: string;
  };
  features: {
    autoResearchEnabled: boolean;
    threatLabMode: 'reactive' | 'proactive';
    autoResearchConfig: Record<string, unknown>;
  };
  llm: { ok: boolean; reason?: string; model?: string };
  pipeline: {
    queued: number;
    writesThisHour: number;
    maxPerHour: number;
    debounceMs: number;
    enabled: boolean;
    sources: { semantic: boolean; blocks: boolean; threatIntel: boolean };
    ephemeral: true;
  };
  processedFingerprints: number;
  jobs: {
    autoResearch: ThreatDiscoveryJobStatus & {
      parsed: {
        written: number;
        attempted: number;
        skips: {
          duplicate: number;
          belowMinConfidence: number;
          replayFailed: number;
          llmUnavailable: number;
          llmDiscoveryNull: number;
          other: number;
        };
        summaryLine: string | null;
      };
    };
    threatLab: ThreatDiscoveryJobStatus & {
      parsed: { wroteAuthentic: number | null };
    };
  };
  autoCorpus: {
    total: number;
    last24h: number;
    recent: AutoCorpusEntry[];
  };
  threatLab: {
    total: number;
    pending: number;
    byReviewStatus: Record<string, number>;
  };
  learning: {
    recent: {
      timestamp: string;
      type: string;
      detail: string;
      fingerprint?: string;
      confidence?: number;
    }[];
    counts24h: Record<string, number>;
  };
  promotion: {
    enabled: boolean;
    totalPromoted: number;
    dailyQuota: { used: number; max: number };
    lastPromotionAt: string | null;
  };
};

export async function fetchThreatDiscoveryStatus(): Promise<{
  status: ThreatDiscoveryStatus | null;
  error?: string;
}> {
  const res = await mastyfAiFetch('/api/threat-discovery/status');
  if (res.status === 404) {
    return {
      status: null,
      error:
        'Threat Discovery API not found — run `pnpm exec tsc && pnpm dashboard:build`, then restart `pnpm dashboard:proxy mastyf-ai-configs/filesystem.json`.',
    };
  }
  if (res.status === 402) {
    return { status: null, error: 'Security swarm API unavailable on this deployment.' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { status: null, error: body.error || `HTTP ${res.status}` };
  }
  return { status: (await res.json()) as ThreatDiscoveryStatus };
}

export async function fetchThreatAutomationSummary(): Promise<{
  status: ThreatAutomationSummary | null;
  error?: string;
}> {
  const res = await mastyfAiFetch('/api/threat-discovery/automation/summary');
  if (res.status === 404) {
    return {
      status: null,
      error:
        'Threat Discovery automation summary API not found — run `pnpm exec tsc && pnpm dashboard:build`, then restart `pnpm dashboard:proxy mastyf-ai-configs/filesystem.json`.',
    };
  }
  if (res.status === 402) {
    return { status: null, error: 'Security swarm API unavailable on this deployment.' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { status: null, error: body.error || `HTTP ${res.status}` };
  }
  return { status: (await res.json()) as ThreatAutomationSummary };
}

export async function runThreatLab(
  mode: 'reactive' | 'proactive' = 'reactive',
): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  const res = await mastyfAiFetch('/api/threat-discovery/threat-lab/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  const body = (await res.json()) as { error?: string; jobId?: string };
  return { ok: res.ok, error: body.error, jobId: body.jobId };
}

export async function runAutoThreatResearch(): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  const res = await mastyfAiFetch('/api/threat-discovery/auto-research/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = (await res.json()) as { error?: string; jobId?: string };
  return { ok: res.ok, error: body.error, jobId: body.jobId };
}

export async function fetchThreatLabCandidate(id: string): Promise<ThreatLabCandidate | null> {
  const res = await mastyfAiFetch(`/api/threat-discovery/candidates/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as ThreatLabCandidate;
}

export async function fetchThreatLabCandidates(): Promise<ThreatLabCandidate[]> {
  const res = await mastyfAiFetch('/api/security-swarm/threat-lab-candidates');
  if (!res.ok) return [];
  const body = (await res.json()) as { candidates?: ThreatLabCandidate[] };
  return body.candidates || [];
}

export async function acceptThreatLabCandidate(id: string): Promise<{
  ok: boolean;
  error?: string;
  ruleName?: string;
}> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/security-swarm/threat-lab-candidates/accept', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    return { ok: false, error: await parseApiError(res) };
  }
  const body = (await res.json().catch(() => ({}))) as { ruleName?: string; error?: string };
  return { ok: true, ruleName: body.ruleName };
}

export async function rejectThreatLabCandidate(id: string): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/security-swarm/threat-lab-candidates/reject', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    return { ok: false, error: await parseApiError(res) };
  }
  return { ok: true };
}

export type AutoCorpusEntry = {
  advId: string;
  relPath: string;
  fingerprint: string;
  source: string;
  attackClass: string;
  hypothesis: string;
  confidence: number;
  timestamp: string;
  toolName: string;
  category: string;
};

export async function fetchAutoCorpusManifest(): Promise<AutoCorpusEntry[]> {
  const res = await mastyfAiFetch('/api/security-swarm/auto-corpus');
  if (!res.ok) return [];
  const body = (await res.json()) as { entries?: AutoCorpusEntry[] };
  return body.entries || [];
}

export type LiveScenarioResult = {
  scenario: string;
  tool: string;
  expected: string;
  actual: string;
  ok: boolean;
  error?: string | null;
  rule?: string | null;
};

export type LiveFilesystemSession = {
  summary?: {
    scenariosRun: number;
    scenariosPassed: number;
    scenariosFailed: number;
    allPassed: boolean;
  };
  proxyResults?: LiveScenarioResult[];
};

export async function fetchSwarmLiveSession(): Promise<LiveFilesystemSession | null> {
  const res = await mastyfAiFetch('/api/security-swarm/live-session');
  if (!res.ok) return null;
  return (await res.json()) as LiveFilesystemSession;
}

export async function fetchPlainEnglishReport(): Promise<PlainEnglishReport | null> {
  const res = await mastyfAiFetch('/api/security-swarm/report-json');
  if (!res.ok) return null;
  return (await res.json()) as PlainEnglishReport;
}

export async function fetchTrafficSummary(): Promise<TrafficSummary | null> {
  const res = await mastyfAiFetch('/api/security-swarm/traffic-summary');
  if (!res.ok) return null;
  return (await res.json()) as TrafficSummary;
}

export async function fetchUserServersSession(): Promise<Record<string, unknown> | null> {
  const res = await mastyfAiFetch('/api/security-swarm/user-servers');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchOnboardingStatus(): Promise<OnboardingStatus | null> {
  const res = await mastyfAiFetch('/api/onboarding/status');
  if (!res.ok) return null;
  return (await res.json()) as OnboardingStatus;
}

export type AnalyticsSummaryResponse = {
  available?: boolean;
  windowDays?: number;
  generatedAt?: string;
  totalRequests?: number;
  avgLatencyMs?: number;
  errorRatePct?: number;
  tokensUsed?: number;
  budgetUsd?: number | null;
  budgetUtilizationPct?: number | null;
  trafficSeries?: Array<{ bucket: string; requests: number; blocked: number }>;
  latencySeries?: Array<{ bucket: string; p50Ms: number; p95Ms: number }>;
  errorRateSeries?: Array<{ bucket: string; errorRatePct: number; blocked: number; requests: number }>;
  costSeries?: Array<{ bucket: string; costUsd: number; label: string }>;
  meta?: ChartMeta;
  modelUsage?: Array<{ model: string; label: string; calls: number; tokens: number; pct: number }>;
  providerCosts?: Array<{
    provider: string;
    label: string;
    costUsd: number;
    colorKey: 'openai' | 'anthropic' | 'google' | 'other';
  }>;
  emptyReason?: string;
  error?: string;
};

export async function fetchAnalyticsSummary(
  window: string = '7d',
): Promise<AnalyticsSummaryResponse | null> {
  const res = await mastyfAiFetch(`/api/analytics/summary?window=${encodeURIComponent(window)}`);
  if (!res.ok) return null;
  return (await res.json()) as AnalyticsSummaryResponse;
}

export type SecurityDashboardThreat = {
  id: string;
  threatKey: string;
  type: string;
  source: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'blocked' | 'monitored' | 'resolved';
};

export type SecurityMonitorQuarantineRecord = SecurityDashboardThreat & {
  quarantinedAt: string;
  operator?: string;
  note?: string;
  appliedRuleName?: string;
  policyPath?: string;
  enforcementStatus?: 'applied' | 'already_present' | 'already_blocked' | 'no_context' | 'skipped';
  enforcementDetail?: string;
  sourceKind?: 'semantic' | 'block' | 'unknown';
};

export type SecurityDashboardResponse = {
  available?: boolean;
  windowDays?: number;
  generatedAt?: string;
  securityScore?: number | null;
  scoreLabel?: string;
  layers?: Array<{ id: string; label: string; status: 'secure' | 'alert' }>;
  executiveSummary?: string[];
  threats?: SecurityDashboardThreat[];
  activeThreatCount?: number;
  quarantinedCount?: number;
  semanticEngineActive?: boolean;
  autoBlockOn?: boolean;
  auditLatencyMs?: number | null;
  rbacPolicy?: string;
  roles?: string[];
  error?: string;
  emptyReason?: string;
};

export async function fetchSecurityDashboard(
  window: string = '24h',
): Promise<SecurityDashboardResponse | null> {
  const res = await mastyfAiFetch(`/api/security/dashboard?window=${encodeURIComponent(window)}`);
  if (!res.ok) return null;
  return (await res.json()) as SecurityDashboardResponse;
}

export async function quarantineAllThreats(
  window: string = '7d',
): Promise<{
  ok: boolean;
  quarantined?: number;
  error?: string;
}> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/security/threats/quarantine', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true, window }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error || `HTTP ${res.status}` };
  }
  return (await res.json()) as { ok: boolean; quarantined?: number };
}

export async function quarantineSecurityThreat(
  row: SecurityDashboardThreat,
  note?: string,
  window: string = '7d',
): Promise<{
  ok: boolean;
  error?: string;
  appliedRuleName?: string;
  enforcementStatus?: SecurityMonitorQuarantineRecord['enforcementStatus'];
}> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/security/threats/quarantine', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...row, note, window }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error || `HTTP ${res.status}` };
  }
  const body = (await res.json().catch(() => ({}))) as {
    appliedRuleName?: string;
    enforcementStatus?: SecurityMonitorQuarantineRecord['enforcementStatus'];
  };
  return { ok: true, appliedRuleName: body.appliedRuleName, enforcementStatus: body.enforcementStatus };
}

export async function fetchSecurityQuarantinedThreats(
  days = 30,
): Promise<SecurityMonitorQuarantineRecord[]> {
  const res = await mastyfAiFetch(`/api/security/threats/quarantined?days=${days}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { entries?: SecurityMonitorQuarantineRecord[] };
  return body.entries ?? [];
}

export async function restoreSecurityThreat(
  threatKey: string,
  opts?: { removeRule?: boolean },
): Promise<{ ok: boolean; error?: string; removedRule?: boolean }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/security/threats/restore', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ threatKey, removeRule: opts?.removeRule === true }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error || `HTTP ${res.status}` };
  }
  const body = (await res.json().catch(() => ({}))) as { removedRule?: boolean };
  return { ok: true, removedRule: body.removedRule };
}

export type SetupMastyfAiConfig = {
  upstreamUrl?: string;
  listenPort?: number;
  authTokenPreview?: string | null;
  configured?: boolean;
};

export type SetupStatusResponse = {
  available?: boolean;
  completedCount?: number;
  totalSteps?: number;
  mastyfAiConfig?: SetupMastyfAiConfig & { done?: boolean };
  database?: { done?: boolean; engine?: string; version?: string; latencyMs?: number | null; error?: string };
  proxyTraffic?: { done?: boolean; totalCalls?: number; healthy?: boolean };
  cloud?: { connected?: boolean; controlPlaneUrl?: string | null };
  onboarding?: OnboardingStatus;
  error?: string;
};

export async function fetchSetupStatus(): Promise<SetupStatusResponse | null> {
  const res = await mastyfAiFetch('/api/setup/status');
  if (!res.ok) return null;
  return (await res.json()) as SetupStatusResponse;
}

export async function saveSetupMastyfAiConfig(body: {
  upstreamUrl: string;
  listenPort: number;
  authToken?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/setup/mastyf-ai-config', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  }
  return { ok: true };
}

export type SetupCloudStatus = {
  connected?: boolean;
  controlPlaneUrl?: string | null;
  ssoEnabled?: boolean;
  policyStrictnessPct?: number;
  apiKeyRotationEnabled?: boolean;
};

export async function fetchSetupCloudStatus(): Promise<SetupCloudStatus | null> {
  const res = await mastyfAiFetch('/api/cloud/status');
  if (!res.ok) return null;
  return (await res.json()) as SetupCloudStatus;
}

export async function connectSetupCloud(body: {
  controlPlaneUrl: string;
  ssoEnabled?: boolean;
  policyStrictnessPct?: number;
  apiKeyRotationEnabled?: boolean;
}): Promise<{ ok: boolean; launchUrl?: string; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/cloud/connect', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  }
  return (await res.json()) as { ok: boolean; launchUrl?: string };
}

export type AutopilotStatus = {
  timestamp?: string;
  autopilotEnabled?: boolean;
  config?: Record<string, unknown>;
  license?: { pro?: boolean; swarm?: boolean; ai?: boolean; dashboard?: boolean };
  protection?: { historyDbAttached?: boolean; policyAutoApply?: boolean };
  learning?: {
    aiEnabled?: boolean;
    pendingSuggestions?: number;
    threatResearchEnabled?: boolean;
    threatResearchQueue?: { queued?: number; writesThisHour?: number; maxPerHour?: number };
  };
  scheduler?: { running?: boolean; nextRunAt?: string | null; lastRunAt?: string | null };
  lastDigest?: { generatedAt?: string; healthPath?: string; securityPath?: string };
  recentEvents?: Array<{ timestamp: string; type: string; detail: string }>;
  llm?: { ok?: boolean; reason?: string };
  messages?: string[];
  available?: boolean;
  error?: string;
};

export async function fetchAutopilotStatus(): Promise<AutopilotStatus | null> {
  const res = await mastyfAiFetch('/api/autopilot/status');
  if (!res.ok) return null;
  return (await res.json()) as AutopilotStatus;
}

export type ThreatPromotionStats = {
  enabled?: boolean;
  promoted?: number;
  pending?: number;
  skipped?: number;
  lastRunAt?: string | null;
  error?: string;
};

export async function fetchThreatPromotionStats(): Promise<ThreatPromotionStats | null> {
  const res = await mastyfAiFetch('/api/threat-discovery/promote/stats');
  if (!res.ok) return null;
  return (await res.json()) as ThreatPromotionStats;
}

export async function runThreatPromotionBatch(): Promise<{ ok: boolean; error?: string; stats?: ThreatPromotionStats }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/threat-discovery/promote/batch', {
    method: 'POST',
    headers,
  });
  const body = (await res.json().catch(() => ({}))) as ThreatPromotionStats & { error?: string };
  if (!res.ok) return { ok: false, error: body.error || `HTTP ${res.status}` };
  return { ok: true, stats: body };
}

export type SimilarEnvironmentBenchmark = {
  serverName: string;
  totalCalls: number;
  blockedRate: number;
  avgLatencyMs: number;
  avgTokens: number;
  peerBlockedRateP50: number;
  peerBlockedRateP90: number;
  peerLatencyP50: number;
  peerLatencyP90: number;
  status: 'outperforming' | 'neutral' | 'needs_attention';
};

export type SimilarEnvironmentBenchmarksResponse = {
  tenantId: string;
  benchmarks: SimilarEnvironmentBenchmark[];
  available?: boolean;
};

export async function fetchSimilarEnvironmentBenchmarks(): Promise<SimilarEnvironmentBenchmarksResponse | null> {
  const res = await mastyfAiFetch('/api/benchmarks/similar-environment');
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as SimilarEnvironmentBenchmarksResponse);
}

export type ContinuousAssuranceReport = {
  generatedAt: string;
  tenantId: string;
  controls: {
    trafficProtected: boolean;
    llmReachable: boolean;
    pendingSuggestions: number;
    threatResearchQueue: number;
  };
  metrics: {
    totalCalls: number;
    blockedCalls: number;
    blockedRate: number;
    avgLatencyMs: number;
  };
  benchmarkSummary: {
    servers: number;
    needsAttention: number;
    outperforming: number;
  };
  attestations: string[];
  available?: boolean;
};

export async function fetchContinuousAssuranceReport(): Promise<ContinuousAssuranceReport | null> {
  const res = await mastyfAiFetch('/api/assurance/continuous');
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as ContinuousAssuranceReport);
}

export async function fetchLatestDigest(): Promise<{
  healthMarkdown?: string;
  securityJson?: Record<string, unknown>;
  generatedAt?: string;
}> {
  const res = await mastyfAiFetch('/api/reports/digests/latest');
  if (!res.ok) return {};
  const body = (await res.json()) as {
    healthMarkdown?: string;
    securityJson?: Record<string, unknown>;
    generatedAt?: string;
    available?: boolean;
  };
  return {
    healthMarkdown: body.healthMarkdown,
    securityJson: body.securityJson,
    generatedAt: body.generatedAt,
  };
}

export async function generateDigestNow(): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/reports/generate', { method: 'POST', headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error || `HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function fetchPendingSuggestions(): Promise<{
  count: number;
  suggestions: unknown[];
}> {
  const res = await mastyfAiFetch('/api/ai/suggestions/pending');
  if (!res.ok) return { count: 0, suggestions: [] };
  const body = (await res.json()) as { count?: number; suggestions?: unknown[] };
  return { count: body.count ?? 0, suggestions: body.suggestions ?? [] };
}

export type UnifiedFleetServer = {
  name: string;
  transport: string;
  source: string;
  wrapped: boolean;
  localUrl?: string;
  status?: string;
  metrics?: {
    totalCalls: number;
    blocked: number;
    passed: number;
    lastSeen: string | null;
  };
};

export type FleetHubState = {
  servers: Array<{
    name: string;
    pid: number;
    port: number;
    transport: string;
    status: string;
    localUrl: string;
  }>;
  startedAt: string;
};

export async function fetchServerRegistry(): Promise<{
  servers: ServerRegistryEntry[];
  uiServers: UiMcpServerConfig[];
  unified?: UnifiedFleetServer[];
  fleet?: FleetHubState | null;
}> {
  const res = await mastyfAiFetch('/api/servers/registry');
  if (!res.ok) return { servers: [], uiServers: [] };
  const body = (await res.json()) as {
    servers?: ServerRegistryEntry[];
    uiServers?: UiMcpServerConfig[];
    unified?: UnifiedFleetServer[];
    fleet?: FleetHubState | null;
  };
  return {
    servers: body.servers || [],
    uiServers: body.uiServers || [],
    unified: body.unified || [],
    fleet: body.fleet ?? null,
  };
}

export async function fetchFleetHubStatus(): Promise<{
  entries: UnifiedFleetServer[];
  fleet: FleetHubState | null;
}> {
  const res = await mastyfAiFetch('/api/fleet/status');
  if (!res.ok) return { entries: [], fleet: null };
  return (await res.json()) as { entries: UnifiedFleetServer[]; fleet: FleetHubState | null };
}

export async function restartFleetHub(): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/fleet/restart', { method: 'POST', headers });
  return (await res.json()) as { ok: boolean; error?: string };
}

export async function stopFleetHub(): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/fleet/stop', { method: 'POST', headers });
  return (await res.json()) as { ok: boolean; error?: string };
}

export type UiMcpServerConfig = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  transport?: 'stdio' | 'sse';
  url?: string;
  disabled?: boolean;
};

export async function addMcpServer(config: UiMcpServerConfig): Promise<{
  ok: boolean;
  error?: string;
  localUrl?: string;
  reloadRequired?: boolean;
}> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch('/api/servers', {
    method: 'POST',
    headers,
    body: JSON.stringify(config),
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

export async function removeMcpServer(name: string): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/servers/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers,
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

export async function updateMcpServer(name: string, patch: Partial<UiMcpServerConfig>): Promise<{ ok: boolean; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(`/api/servers/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

export type AgenticTrafficPoint = { bucket: string; requests: number; blocked: number };

export type AgenticTrustScore = {
  serverName: string;
  overallScore: number;
  grade: string;
  categories: Array<{ name: string; score: number; weight: number; maxScore: number; details: string; findings: string[] }>;
  computedAt: string;
  improvementActions?: Array<{ priority: string; category: string; action: string; expectedScoreIncrease: number }>;
};

export type AgenticServerTrust = {
  name: string;
  transport: string;
  wrapped: boolean;
  metrics?: { totalCalls: number; blocked: number; passed: number; lastSeen: string | null };
  trust: AgenticTrustScore | null;
};

export type AgenticDashboardResponse = {
  available?: boolean;
  agenticEnabled?: boolean;
  windowDays?: number;
  generatedAt?: string;
  kpis?: {
    uptimeMs: number;
    totalDecisions: number;
    avgConfidence: number;
    llmTokensUsed: number;
    llmCostEstimate: number;
    llmAvailable: boolean;
    blockedRequests: number;
    totalRequests: number;
    injectionDetectionRate: number;
    injectionScans: number;
    meshSignatures: number;
    meshEnabled: boolean;
    honeypotActive: number;
    honeypotCaptures: number;
    taskQueued: number;
    taskRunning: number;
    complianceOverall: number;
    trustGrade: string;
    trustScore: number;
    activeSessions: number;
  };
  trafficSeries?: AgenticTrafficPoint[];
  decisionsByFeature?: Record<string, number>;
  recentDecisions?: Array<{
    decisionId: string;
    feature: string;
    rationale: string;
    confidence: number;
    outcome?: string;
    timestamp: string;
  }>;
  featureHealth?: Array<{ name: string; status: string }>;
  servers?: AgenticServerTrust[];
  compliance?: {
    overall: number;
    frameworks: Array<{
      framework: string;
      frameworkName: string;
      postureScore: number;
      satisfiedControls: number;
      totalControls: number;
    }>;
  };
  policyGen?: { active: boolean; totalCalls: number; uniqueTools: number; uptimeMin: number };
  honeypots?: { active: number; totalCaptures: number; recentAlerts: number };
  mesh?: { enabled: boolean; localSignatures: number; pendingSignatures: number };
  promptInjectionStats?: { totalScans: number; totalDetections: number; detectionRate: number };
  trustSessions?: { activeSessions: number; registeredAgents: number; totalNegotiations: number };
  meta?: { dataSources?: string[]; generatedAt?: string };
  emptyReason?: string;
  historyOutsideWindow?: number;
  suggestedWindow?: '1h' | '12h' | '24h' | '7d' | '30d' | '90d';
  windowLabel?: string;
  error?: string;
};

export type AgenticAuditRecord = {
  recordId: string;
  timestamp: string;
  sessionId: string;
  method: string;
  toolName?: string;
  argsSummary: string;
  latencyMs: number;
  blocked: boolean;
  blockReason?: string;
  statusCode: string;
};

export async function fetchAgenticDashboard(window = '7d'): Promise<AgenticDashboardResponse | null> {
  const res = await mastyfAiFetch(`/api/agentic/dashboard?window=${encodeURIComponent(window)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as AgenticDashboardResponse;
  if (body.error && body.available === false && !body.kpis) return null;
  return body;
}

export async function fetchAgenticAudit(limit = 50): Promise<{
  records: AgenticAuditRecord[];
  stats: { totalRecords: number; totalBlocked: number; totalAllowed: number; averageLatencyMs: number };
} | null> {
  const res = await mastyfAiFetch(`/api/agentic/audit?limit=${limit}`);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    available?: boolean;
    records?: AgenticAuditRecord[];
    stats?: { totalRecords: number; totalBlocked: number; totalAllowed: number; averageLatencyMs: number };
  };
  if (body.available === false) return null;
  return { records: body.records ?? [], stats: body.stats ?? { totalRecords: 0, totalBlocked: 0, totalAllowed: 0, averageLatencyMs: 0 } };
}

export async function fetchAgenticDecisions(limit = 50): Promise<AgenticDashboardResponse['recentDecisions']> {
  const res = await mastyfAiFetch(`/api/agentic/decisions?limit=${limit}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { decisions?: AgenticDashboardResponse['recentDecisions'] };
  return body.decisions ?? [];
}

export async function fetchAgenticTasksDetail(): Promise<{
  stats: { queued: number; running: number; completed: number; failed: number; total: number };
  pendingApprovals: Array<{ requestId: string; toolName: string; description: string; createdAt: string }>;
} | null> {
  const res = await mastyfAiFetch('/api/agentic/tasks/detail');
  if (!res.ok) return null;
  const body = (await res.json()) as {
    stats?: { queued: number; running: number; completed: number; failed: number; total: number };
    pendingApprovals?: Array<{ requestId: string; toolName: string; description: string; createdAt: string }>;
  };
  return {
    stats: body.stats ?? { queued: 0, running: 0, completed: 0, failed: 0, total: 0 },
    pendingApprovals: body.pendingApprovals ?? [],
  };
}

export async function agenticPost(
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await mastyfAiFetch(path, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    return { ok: false, error: await parseApiError(res) };
  }
  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: true, data: null };
  }
}

export async function fetchCertificationRegistry(): Promise<{
  certifications: Array<{
    serverName: string;
    packageName: string;
    level: string;
    score: number;
    expiresAt: string;
  }>;
  count: number;
} | null> {
  const res = await mastyfAiFetch('/api/certification/registry');
  if (!res.ok) return null;
  const body = (await res.json()) as {
    certifications?: Array<{
      serverName: string;
      packageName: string;
      level: string;
      score: number;
      expiresAt: string;
    }>;
    count?: number;
  };
  return { certifications: body.certifications ?? [], count: body.count ?? 0 };
}

const DEFAULT_CLOUD_PUBLIC_URL = 'https://mastyf-ai-cloud.vercel.app';
const BADGE_RENDERER_VERSION = '3';

export function resolveCloudPublicUrl(override?: string | null): string {
  const url = override?.trim() || DEFAULT_CLOUD_PUBLIC_URL;
  return url.replace(/\/$/, '');
}

function withGithubBadgeStyle(url: string): string {
  let out = url;
  if (!out.includes('style=')) {
    out = `${out}${out.includes('?') ? '&' : '?'}style=github`;
  }
  if (!out.includes('v=')) {
    out = `${out}&v=${BADGE_RENDERER_VERSION}`;
  }
  return out;
}

export type PublicBadgeMetadata = {
  found: boolean;
  packageName: string;
  score?: number;
  grade?: string;
  level?: string;
  badgeUrl?: string;
  verifyUrl?: string;
  embedMarkdown?: string;
};

export async function fetchPublicBadgeMetadata(
  packageName: string,
  cloudBaseUrl?: string | null,
): Promise<PublicBadgeMetadata | null> {
  const base = resolveCloudPublicUrl(cloudBaseUrl);
  const pkg = encodeURIComponent(packageName);
  try {
    const res = await fetch(`${base}/api/v1/badge/${pkg}/json`, { cache: 'no-store' });
    if (!res.ok) {
      if (res.status === 404) {
        return { found: false, packageName };
      }
      return null;
    }
    const body = (await res.json()) as {
      found?: boolean;
      packageName?: string;
      score?: number;
      grade?: string;
      level?: string;
      badgeUrl?: string;
      verifyUrl?: string;
    };
    const badgeUrl = withGithubBadgeStyle(
      body.badgeUrl ?? `${base}/api/v1/badge/${pkg}?style=github&v=${BADGE_RENDERER_VERSION}`,
    );
    const verifyUrl = body.verifyUrl ?? `${base}/certified/${pkg}`;
    return {
      found: body.found ?? true,
      packageName: body.packageName ?? packageName,
      score: body.score,
      grade: body.grade,
      level: body.level,
      badgeUrl,
      verifyUrl,
      embedMarkdown: `[![mastyf.ai security score](${badgeUrl})](${verifyUrl})`,
    };
  } catch {
    return null;
  }
}

export async function fetchIndustryChainGraph(): Promise<{
  events: Array<{ sessionId: string; agentId: string | null; serverName: string; toolName: string; eventType: string; blocked: boolean }>;
  count: number;
} | null> {
  const res = await mastyfAiFetch('/api/industry-standard/chain-graph');
  if (!res.ok) return null;
  const body = (await res.json()) as { events?: unknown[]; count?: number };
  return { events: (body.events ?? []) as NonNullable<Awaited<ReturnType<typeof fetchIndustryChainGraph>>>['events'], count: body.count ?? 0 };
}

export async function fetchIndustryCapabilityGraph(): Promise<{
  edges: Array<{ serverName: string; sourceTool: string; targetResource: string | null; edgeType: string }>;
  count: number;
} | null> {
  const res = await mastyfAiFetch('/api/industry-standard/capability-graph');
  if (!res.ok) return null;
  const body = (await res.json()) as { edges?: unknown[]; count?: number };
  return { edges: (body.edges ?? []) as NonNullable<Awaited<ReturnType<typeof fetchIndustryCapabilityGraph>>>['edges'], count: body.count ?? 0 };
}

export async function fetchIndustrySandboxTiers(): Promise<{
  tiers: Array<{ serverName: string; tier: string; certLevel: string }>;
} | null> {
  const res = await mastyfAiFetch('/api/industry-standard/sandbox-tiers');
  if (!res.ok) return null;
  const body = (await res.json()) as { tiers?: Array<{ serverName: string; tier: string; certLevel: string }> };
  return { tiers: body.tiers ?? [] };
}

export async function approvePlaybookAction(approvalId: string, approve: boolean): Promise<{ ok: boolean; error?: string }> {
  const res = await mastyfAiFetch('/api/agentic/playbook/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvalId, approve }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? res.statusText };
  }
  return { ok: true };
}

export type PlanComplianceReport = {
  overallScore: number;
  productionReady: boolean;
  modules: Array<{ id: string; name: string; score: number; checks: Array<{ id: string; passed: boolean; detail: string }> }>;
  generatedAt: string;
  summary: string;
};

export async function fetchPlanComplianceAudit(): Promise<PlanComplianceReport | null> {
  const res = await mastyfAiFetch('/api/agentic/plan-compliance/audit');
  if (!res.ok) return null;
  const body = (await res.json()) as PlanComplianceReport & { error?: string };
  if (body.error && !body.modules?.length) return null;
  return body;
}

export type FederatedStatus = {
  enabled: boolean;
  activeVersion: string;
  stats: Record<string, unknown>;
};

export async function fetchFederatedStatus(): Promise<FederatedStatus | null> {
  const res = await mastyfAiFetch('/api/agentic/federated/status');
  if (!res.ok) return null;
  return (await res.json()) as FederatedStatus;
}

export async function aggregateFederatedDeltas(minContributors = 1): Promise<{ aggregated?: boolean; contributorCount?: number } | null> {
  const res = await mastyfAiFetch('/api/agentic/federated/aggregate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minContributors, syncRemote: true }),
  });
  if (!res.ok) return null;
  return (await res.json()) as { aggregated?: boolean; contributorCount?: number };
}

export async function promoteFederatedRollout(): Promise<{ stage?: string; decision?: unknown } | null> {
  const res = await mastyfAiFetch('/api/agentic/federated/promote-rollout', { method: 'POST' });
  if (!res.ok) return null;
  return (await res.json()) as { stage?: string; decision?: unknown };
}

export async function fetchFederatedExportBundle(): Promise<unknown | null> {
  const res = await mastyfAiFetch('/api/agentic/federated/export');
  if (!res.ok) return null;
  return res.json();
}

export type ReputationEntry = {
  serverName: string;
  consensusScore: number;
  level?: string;
  dimensions?: Record<string, number>;
  attestationJws?: string;
};

export async function queryServerReputation(serverName: string, networkFetch = true): Promise<ReputationEntry | null> {
  const res = await mastyfAiFetch('/api/agentic/reputation/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverName, networkFetch }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { entry: ReputationEntry | null };
  return body.entry;
}

export async function syncReputationMesh(): Promise<number> {
  const res = await mastyfAiFetch('/api/agentic/reputation/sync-mesh', { method: 'POST' });
  if (!res.ok) return 0;
  const body = (await res.json()) as { ingested?: number };
  return body.ingested ?? 0;
}

export type ZeroTrustScore = {
  composite: number;
  action: 'allow' | 'block' | 'step_up';
  dimensions: Record<string, number>;
  reason?: string;
};

export async function fetchZeroTrustScore(params: {
  agentId: string;
  sessionId: string;
  serverName: string;
  toolName: string;
  authenticated?: boolean;
}): Promise<ZeroTrustScore | null> {
  const res = await mastyfAiFetch('/api/agentic/zero-trust/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) return null;
  return (await res.json()) as ZeroTrustScore;
}

export type ChainGraph = {
  nodes: Array<{ id: string; label: string; type: 'agent' | 'server' | 'tool' }>;
  edges: Array<{ from: string; to: string; label: string; blocked?: boolean }>;
  alerts: Array<{ alertId: string; pattern: string; description: string; confidence: number }>;
};

export async function fetchFleetChainGraph(sessionId?: string): Promise<ChainGraph | null> {
  const q = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  const res = await mastyfAiFetch(`/api/agentic/fleet-chains/graph${q}`);
  if (!res.ok) return null;
  return (await res.json()) as ChainGraph;
}

export function resolveWsUrl(): string {
  const base = resolveApiBase();
  try {
    const origin = base || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');
    const u = new URL('/ws', origin);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const tenant = getTenantId();
    if (tenant) u.searchParams.set('tenant', tenant);
    return u.toString();
  } catch {
    return 'ws://localhost:4000/ws';
  }
}
