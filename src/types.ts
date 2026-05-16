export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // for SSE/HTTP transports
  transport: 'stdio' | 'sse';
  // metadata
  packageName?: string;
  version?: string;
}

export interface SecurityReport {
  serverName: string;
  cves: CveFinding[];
  /** ok = feeds responded; degraded/unavailable = rate-limited or offline — not "no CVEs" */
  cveLookupStatus?: 'ok' | 'degraded' | 'unavailable';
  authStatus: AuthStatus;
  typoSquatRisk: TypoSquatResult[];
  secretsFound: SecretFinding[];
  cmdWarnings?: import('./scanners/command-validator.js').CommandWarning[];
  score: number; // 0-100
  recommendations: string[];
  hasMTLS?: boolean;
}

export interface CveFinding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
  fixedVersion?: string;
}

export interface AuthStatus {
  hasAuthentication: boolean;
  method?: string;
  isTransportEncrypted: boolean;
}

export interface TypoSquatResult {
  suspiciousName: string;
  similarityTo: string;
  distance: number;
}

export interface SecretFinding {
  type: string; // 'api_key', 'token', 'password', 'high-entropy-string'
  location: string;
  severity: 'HIGH' | 'MEDIUM' | 'high' | 'medium';
  /** Redacted display string (e.g. "sk-ant-[REDACTED]b3f2") */
  redacted?: string;
  /** Context where the secret was found (e.g. env var name) */
  context?: string;
  /** Detection method: 'regex' or 'entropy' */
  method?: 'regex' | 'entropy';
}

export interface CostReport {
  serverName: string;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  /** Sum of per-call costUsd from proxy records */
  actualCostUSD: number;
  pricingModel: string;
  /** How rates were resolved (cline client prices, litellm live, etc.) */
  pricingSources: string[];
  toolBreakdown: ToolCost[];
  unpricedCalls?: number;
  note?: string;
}

export interface ToolCost {
  toolName: string;
  tokens: number;
  calls: number;
  cost: number;
}

export interface HealthReport {
  serverName: string;
  latencyMs: number;
  successRate: number; // 0-1
  contextPressure: number; // 0-1
  toolCount: number;
  overloadWarning: boolean;
  recommendations: string[];
}

export interface FullReport {
  timestamp: string;
  configPath: string;
  security: SecurityReport[];
  costs: CostReport[];
  health: HealthReport[];
  overallScore: number;
}

/**
 * Recorded by the MCP proxy interceptor for real cost tracking.
 */
export type PricingSource = 'cline' | 'cursor' | 'env' | 'message' | 'litellm' | 'unknown';

export interface ProxyCallRecord {
  serverName: string;
  toolName: string;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  durationMs: number;
  timestamp: string;
  /** LLM model billed for this call (detected at proxy time) */
  model?: string;
  /** USD cost from client or live provider rates — not a static estimate */
  costUsd?: number;
  pricingSource?: PricingSource;
  /** True when the proxy denied the call (policy, DLP, auth) before upstream responded */
  blocked?: boolean;
  blockRule?: string;
  blockReason?: string;
  /** Whether token counts came from provider API usage or local estimate */
  tokenSource?: 'api' | 'estimated';
}