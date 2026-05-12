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
  pricingModel: string;
  toolBreakdown: ToolCost[];
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
export interface ProxyCallRecord {
  serverName: string;
  toolName: string;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  durationMs: number;
  timestamp: string;
}