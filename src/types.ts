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
  score: number; // 0-100
  recommendations: string[];
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
  type: string; // 'api_key', 'token', 'password'
  location: string;
  severity: 'HIGH' | 'MEDIUM';
}

export interface CostReport {
  serverName: string;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  pricingModel: string;
  toolBreakdown: ToolCost[];
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