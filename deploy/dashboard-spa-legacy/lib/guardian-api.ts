import { TRIBUNAL_BATCH_LIMIT } from './tribunal-config';

export type GuardianHeaders = Record<string, string>;

const TENANT_STORAGE_KEY = 'mcp-guardian-tenant-id';

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

export type CostResponse = {
  available?: boolean;
  totalCost: number | null;
  projectedMonthly?: number | null;
  burnRatePerHour?: number | null;
  budgetUsd?: number | null;
  pricingModel?: string;
  windowDays?: number;
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
  passRatePct?: number;
  blockRatePct?: number;
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
  const envBase = process.env.NEXT_PUBLIC_GUARDIAN_API;
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

export function buildAuthHeaders(): GuardianHeaders {
  const headers: GuardianHeaders = { Accept: 'application/json' };
  if (typeof window === 'undefined') return headers;
  const params = new URLSearchParams(window.location.search);
  const apiKey = params.get('apiKey');
  if (apiKey) headers['X-API-Key'] = apiKey;
  const tenant = getTenantId();
  headers['X-Guardian-Tenant'] = tenant;
  headers['X-Tenant-Id'] = tenant;
  return headers;
}

export async function guardianFetch(
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
      ...(init?.headers as GuardianHeaders),
    },
  });
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await guardianFetch('/api/auth/status');
  if (!res.ok) {
    return { authenticated: false, authRequired: true, authConfigured: false };
  }
  return (await res.json()) as AuthStatus;
}

export async function fetchCsrfToken(): Promise<{ csrfToken?: string; csrfEnforced: boolean }> {
  const res = await guardianFetch('/api/auth/csrf');
  if (!res.ok) return { csrfEnforced: false };
  return (await res.json()) as { csrfToken?: string; csrfEnforced: boolean };
}

/** Headers for POST/PUT/DELETE when dashboard CSRF is enforced (cookie session). */
export async function buildMutatingHeaders(
  extra: GuardianHeaders = {},
): Promise<GuardianHeaders> {
  const headers: GuardianHeaders = { 'Content-Type': 'application/json', ...extra };
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
  const headers: GuardianHeaders = { 'Content-Type': 'application/json' };
  if (body.csrfToken) headers['X-CSRF-Token'] = body.csrfToken;
  const res = await guardianFetch('/api/login', {
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
  await guardianFetch('/api/logout', { method: 'POST' });
}

export async function fetchTenantContext(): Promise<{
  tenantId: string;
  multiTenantMode: boolean;
} | null> {
  const res = await guardianFetch('/api/admin/tenant');
  if (!res.ok) return null;
  const data = (await res.json()) as { tenantId?: string; multiTenantMode?: boolean };
  return {
    tenantId: data.tenantId || 'default',
    multiTenantMode: !!data.multiTenantMode,
  };
}

function withWindowRegionQuery(windowDays: number, region?: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ window: String(windowDays) });
  if (region) params.set('region', region);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
  }
  return params.toString();
}

export async function fetchDashboardRegions(): Promise<{ regions: string[] } | null> {
  const res = await guardianFetch('/api/dashboard/regions');
  if (!res.ok) return null;
  const body = (await res.json()) as { regions?: string[]; available?: boolean };
  if (body.available === false) return null;
  return { regions: body.regions ?? [] };
}

export async function fetchAggregateMetrics(windowDays = 7, region?: string): Promise<AggregateMetrics | null> {
  const q = withWindowRegionQuery(windowDays, region);
  const res = await guardianFetch(`/api/aggregate/metrics?${q}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as AggregateMetrics);
}

export async function fetchAudit(opts?: {
  limit?: number;
  action?: string;
  server?: string;
}): Promise<AuditResponse | null> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.action) params.set('action', opts.action);
  if (opts?.server) params.set('server', opts.server);
  const q = params.toString();
  const res = await guardianFetch(`/api/aggregate/audit${q ? `?${q}` : ''}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as AuditResponse & { available?: boolean });
}

export async function fetchCost(windowDays = 7, region?: string): Promise<CostResponse | null> {
  const res = await guardianFetch(`/api/cost?${withWindowRegionQuery(windowDays, region)}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as CostResponse);
}

export async function fetchCostBreakdown(windowDays = 7): Promise<CostBreakdownResponse | null> {
  const res = await guardianFetch(`/api/cost/breakdown?window=${windowDays}`);
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
  windowDays = 7,
): Promise<CostRecommendationsResponse | null> {
  const res = await guardianFetch(`/api/cost/recommendations?window=${windowDays}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as CostRecommendationsResponse);
}

export async function fetchCostTimeseries(
  windowDays = 7,
  granularity: 'hour' | 'day' = 'day',
  region?: string,
): Promise<CostTimeseriesResponse | null> {
  const q = withWindowRegionQuery(windowDays, region, { granularity });
  const res = await guardianFetch(`/api/cost/timeseries?${q}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as CostTimeseriesResponse);
}

export async function fetchExecutiveSummary(
  windowDays = 7,
  region?: string,
): Promise<ExecutiveSummaryResponse | null> {
  const res = await guardianFetch(`/api/dashboard/executive-summary?${withWindowRegionQuery(windowDays, region)}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as ExecutiveSummaryResponse);
}

export async function fetchDashboardInsights(
  scope: 'overview' | 'cost' | 'security' | 'audit' | 'ai',
  windowDays = 7,
): Promise<DashboardInsightsResponse | null> {
  const res = await guardianFetch(`/api/dashboard/insights?scope=${scope}&window=${windowDays}`);
  if (!res.ok) return null;
  const body = (await res.json()) as DashboardInsightsResponse;
  if (body.available === false && !body.bullets?.length) return null;
  return body;
}

export async function downloadInsightsBriefing(
  scope: 'overview' | 'cost' | 'security' | 'audit' | 'ai',
  windowDays = 7,
): Promise<void> {
  const res = await guardianFetch(`/api/dashboard/insights/export?scope=${scope}&window=${windowDays}`);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `guardian-briefing-${scope}-${windowDays}d.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchAuditHeatmap(windowDays = 7, region?: string): Promise<AuditHeatmapResponse | null> {
  const res = await guardianFetch(`/api/audit/heatmap?${withWindowRegionQuery(windowDays, region)}`);
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as AuditHeatmapResponse);
}

export async function fetchSecurity(): Promise<SecurityResponse | null> {
  const res = await guardianFetch('/api/security');
  if (!res.ok) return null;
  return liveOrNull((await res.json()) as SecurityResponse);
}

export async function fetchHealth(): Promise<HealthResponse | null> {
  const res = await guardianFetch('/api/health');
  if (!res.ok) return null;
  const data = liveOrNull((await res.json()) as HealthResponse);
  if (!data) return null;
  return {
    ...data,
    overallStatus: data.overallStatus || data.status || 'unknown',
  };
}

export async function fetchFleetInstances(): Promise<FleetResponse | null> {
  const res = await guardianFetch('/api/instances');
  if (!res.ok) return null;
  const data = await res.json();
  if (Array.isArray(data)) {
    return { available: true, source: 'legacy', instances: data as FleetInstance[] };
  }
  return liveOrNull(data as FleetResponse);
}

export async function fetchAiSuggestions(): Promise<AiSuggestion[]> {
  const res = await guardianFetch('/api/ai/suggestions');
  if (!res.ok) return [];
  const body = (await res.json()) as { suggestions?: AiSuggestion[] };
  return body.suggestions || [];
}

export async function fetchPolicy(): Promise<PolicyInfo | null> {
  const res = await guardianFetch('/api/policy');
  if (!res.ok) return null;
  return (await res.json()) as PolicyInfo;
}

export async function testPolicy(payload: {
  tool: string;
  arguments: Record<string, unknown>;
  server?: string;
}): Promise<Record<string, unknown> | null> {
  const headers = await buildMutatingHeaders();
  const res = await guardianFetch('/api/policy/test', {
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
  const res = await guardianFetch('/api/policy/copilot', {
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
  const res = await guardianFetch('/api/policy/copilot/counterfactual', {
    method: 'POST',
    headers,
    body: JSON.stringify({ rule, windowDays }),
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchActiveLearningReport(): Promise<Record<string, unknown> | null> {
  const res = await guardianFetch('/api/learning/semantic/active-learning');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchAgentAbuseScores(windowDays = 7): Promise<Record<string, unknown> | null> {
  const res = await guardianFetch(`/api/dashboard/agent-abuse?window=${windowDays}`);
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchToolIntegrityReport(): Promise<Record<string, unknown> | null> {
  const res = await guardianFetch('/api/security-swarm/tool-integrity');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchShadowRedTeamReport(): Promise<Record<string, unknown> | null> {
  const res = await guardianFetch('/api/security-swarm/shadow-red-team');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchSupplyChainGraph(): Promise<Record<string, unknown> | null> {
  const res = await guardianFetch('/api/security-swarm/supply-chain');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchSignatureHints(): Promise<Record<string, unknown> | null> {
  const res = await guardianFetch('/api/fleet/signature-hints');
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

export async function fetchTribunalReport(
  limit: number = TRIBUNAL_BATCH_LIMIT,
): Promise<TribunalReport | null> {
  const res = await guardianFetch(
    `/api/learning/semantic/tribunal?limit=${limit}&useLlm=false`,
  );
  if (!res.ok) return null;
  return (await res.json()) as TribunalReport;
}

export async function fetchComplianceReport(windowDays = 7): Promise<Record<string, unknown> | null> {
  const res = await guardianFetch(`/api/ai/compliance/report?window=${windowDays}&useLlm=false`);
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchTenantModelReadiness(): Promise<TenantModelReadinessResponse | null> {
  const res = await guardianFetch('/api/ai/tenant-model/readiness');
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
  const res = await guardianFetch('/api/ai/tenant-model/train', {
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
  const res = await guardianFetch('/api/ai/tenant-model/train/status');
  if (!res.ok) return null;
  return (await res.json()) as TenantModelTrainStatus;
}

export type InvestigateIncidentResult = {
  investigation: Record<string, unknown> | null;
  error?: string;
};

export async function investigateIncident(triggerId: string): Promise<InvestigateIncidentResult> {
  const headers = await buildMutatingHeaders();
  const res = await guardianFetch('/api/incidents/investigate', {
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
          'Incident API is unavailable on this dashboard host. Restart the Guardian proxy after `pnpm build` so it loads the latest dashboard routes.';
      } else if (body.error === 'Trigger record not found') {
        message = 'Semantic audit record not found — it may have aged out of the 7-day window.';
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

export async function acceptSuggestion(suggestion: AiSuggestion): Promise<boolean> {
  const headers = await buildMutatingHeaders();
  const res = await guardianFetch('/api/policy/suggestions/accept', {
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
  return res.ok;
}

export async function rejectSuggestion(suggestion: AiSuggestion): Promise<boolean> {
  const headers = await buildMutatingHeaders();
  const res = await guardianFetch('/api/policy/suggestions/reject', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      suggestionId: suggestion.id || suggestion.ruleName,
      ruleName: suggestion.ruleName || suggestion.id,
      source: suggestion.source || 'attack',
      confidence: suggestion.confidence ?? 0.5,
    }),
  });
  return res.ok;
}

export async function reloadPolicy(): Promise<boolean> {
  const headers = await buildMutatingHeaders();
  const res = await guardianFetch('/api/policy/reload', { method: 'POST', headers });
  return res.ok;
}

export async function savePolicy(yaml: string): Promise<{ ok: boolean; error?: string; details?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await guardianFetch('/api/policy', {
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
  const res = await guardianFetch('/api/security-swarm/run', {
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
  const res = await guardianFetch('/api/security-swarm/status');
  if (!res.ok) return null;
  return (await res.json()) as SwarmJobStatus;
}

export async function fetchSwarmReportPreview(): Promise<string | null> {
  const res = await guardianFetch('/api/security-swarm/report');
  if (!res.ok) return null;
  return res.text();
}

export async function downloadSwarmReport(): Promise<void> {
  const res = await guardianFetch('/api/security-swarm/report/download');
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mcp-guardian-swarm-analysis.txt';
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchAiReport(): Promise<AiReport | null> {
  const res = await guardianFetch('/api/ai/report');
  if (!res.ok) return null;
  return (await res.json()) as AiReport;
}

export async function fetchAiState(): Promise<{
  initialized: boolean;
  state: Record<string, unknown> | null;
} | null> {
  const res = await guardianFetch('/api/ai/state');
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
  const res = await guardianFetch('/api/ai/baselines');
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
};

export async function fetchAiThreats(): Promise<ThreatIntelStatus | null> {
  const res = await guardianFetch('/api/ai/threats');
  if (!res.ok) return null;
  return (await res.json()) as ThreatIntelStatus;
}

export async function pollAiThreats(): Promise<{ ok: boolean; status?: ThreatIntelStatus; error?: string }> {
  const headers = await buildMutatingHeaders();
  const res = await guardianFetch('/api/ai/threats/poll', { method: 'POST', headers, body: '{}' });
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  const status = (await res.json()) as ThreatIntelStatus;
  return { ok: true, status };
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
  const res = await guardianFetch('/api/ai/rollback', { method: 'POST', headers, body: '{}' });
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
  const res = await guardianFetch('/api/learning/semantic/outcomes');
  if (!res.ok) {
    return {
      records: [],
      meta: { hint: 'Semantic outcomes API unavailable — check dashboard auth and Pro license.' },
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
  const res = await guardianFetch('/api/learning/label', {
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
  const res = await guardianFetch('/api/policy/fp/reject', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: await parseApiError(res) };
  return { ok: true };
}

export async function fetchAdminAuditTrail(): Promise<unknown[]> {
  const res = await guardianFetch('/api/admin/audit-trail');
  if (!res.ok) return [];
  const body = (await res.json()) as { entries?: unknown[] };
  return body.entries || [];
}

export async function fetchLogs(): Promise<string[]> {
  const res = await guardianFetch('/api/logs');
  if (!res.ok) return [];
  const body = (await res.json()) as { logs?: string[] };
  return body.logs || [];
}

export async function fetchSwarmLatest(): Promise<SwarmLatest | null> {
  const res = await guardianFetch('/api/security-swarm/latest');
  if (!res.ok) return null;
  return (await res.json()) as SwarmLatest;
}

export async function fetchSwarmFigures(): Promise<SwarmFigureEntry[]> {
  const res = await guardianFetch('/api/security-swarm/figures');
  if (!res.ok) return [];
  const body = (await res.json()) as { figures?: SwarmFigureEntry[] };
  return body.figures || [];
}

export type VisualsLiveFetchResult =
  | { ok: true; data: VisualsData }
  | { ok: false; status: number; message: string };

export async function fetchVisualsLive(windowDays = 7, region?: string): Promise<VisualsLiveFetchResult> {
  const res = await guardianFetch(`/api/visuals/live?${withWindowRegionQuery(windowDays, region)}`);
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
  const res = await guardianFetch('/api/security-swarm/summary');
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
    autoResearch: ThreatDiscoveryJobStatus;
  };
  provenance?: {
    strictLive: boolean;
    sessionActive: boolean;
    legacyAllowed: boolean;
    source: 'session-swarm' | 'legacy-swarm' | 'none';
  };
};

export async function fetchThreatDiscoveryStatus(): Promise<{
  status: ThreatDiscoveryStatus | null;
  error?: string;
}> {
  const res = await guardianFetch('/api/threat-discovery/status');
  if (res.status === 404) {
    return {
      status: null,
      error:
        'Threat Discovery API not found — run `pnpm exec tsc && pnpm dashboard:build`, then restart `pnpm dashboard:proxy guardian-configs/filesystem.json`.',
    };
  }
  if (res.status === 402) {
    return { status: null, error: 'Pro license required (swarm feature).' };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { status: null, error: body.error || `HTTP ${res.status}` };
  }
  return { status: (await res.json()) as ThreatDiscoveryStatus };
}

export async function runThreatLab(
  mode: 'reactive' | 'proactive' = 'reactive',
): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  const res = await guardianFetch('/api/threat-discovery/threat-lab/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  const body = (await res.json()) as { error?: string; jobId?: string };
  return { ok: res.ok, error: body.error, jobId: body.jobId };
}

export async function runAutoThreatResearch(): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  const res = await guardianFetch('/api/threat-discovery/auto-research/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = (await res.json()) as { error?: string; jobId?: string };
  return { ok: res.ok, error: body.error, jobId: body.jobId };
}

export async function fetchThreatLabCandidate(id: string): Promise<ThreatLabCandidate | null> {
  const res = await guardianFetch(`/api/threat-discovery/candidates/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as ThreatLabCandidate;
}

export async function fetchThreatLabCandidates(): Promise<ThreatLabCandidate[]> {
  const res = await guardianFetch('/api/security-swarm/threat-lab-candidates');
  if (!res.ok) return [];
  const body = (await res.json()) as { candidates?: ThreatLabCandidate[] };
  return body.candidates || [];
}

export async function acceptThreatLabCandidate(id: string): Promise<boolean> {
  const res = await guardianFetch('/api/security-swarm/threat-lab-candidates/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return res.ok;
}

export async function rejectThreatLabCandidate(id: string): Promise<boolean> {
  const res = await guardianFetch('/api/security-swarm/threat-lab-candidates/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return res.ok;
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
  const res = await guardianFetch('/api/security-swarm/auto-corpus');
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
  const res = await guardianFetch('/api/security-swarm/live-session');
  if (!res.ok) return null;
  return (await res.json()) as LiveFilesystemSession;
}

export async function fetchPlainEnglishReport(): Promise<PlainEnglishReport | null> {
  const res = await guardianFetch('/api/security-swarm/report-json');
  if (!res.ok) return null;
  return (await res.json()) as PlainEnglishReport;
}

export async function fetchTrafficSummary(): Promise<TrafficSummary | null> {
  const res = await guardianFetch('/api/security-swarm/traffic-summary');
  if (!res.ok) return null;
  return (await res.json()) as TrafficSummary;
}

export async function fetchUserServersSession(): Promise<Record<string, unknown> | null> {
  const res = await guardianFetch('/api/security-swarm/user-servers');
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchOnboardingStatus(): Promise<OnboardingStatus | null> {
  const res = await guardianFetch('/api/onboarding/status');
  if (!res.ok) return null;
  return (await res.json()) as OnboardingStatus;
}

export async function fetchServerRegistry(): Promise<ServerRegistryEntry[]> {
  const res = await guardianFetch('/api/servers/registry');
  if (!res.ok) return [];
  const body = (await res.json()) as { servers?: ServerRegistryEntry[] };
  return body.servers || [];
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
