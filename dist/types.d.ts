export interface McpServerConfig {
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    transport: 'stdio' | 'sse' | 'websocket';
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
    score: number;
    recommendations: string[];
    hasMTLS?: boolean;
    /** SSE/HTTP servers: IDE may connect upstream unless routed through Mastyf AI proxy/wrap */
    untrackedSse?: boolean;
}
export interface CveFinding {
    id: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    summary: string;
    fixedVersion?: string;
    /** Provenance — used to require OSV corroboration for NVD keyword hits */
    source?: 'osv' | 'nvd';
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
    type: string;
    location: string;
    severity: 'HIGH' | 'MEDIUM' | 'high' | 'medium';
    /** Redacted display string (e.g. "sk-ant-[REDACTED]b3f2") */
    redacted?: string;
    /** Context where the secret was found (e.g. env var name) */
    context?: string;
    /** Detection method: 'regex' or 'entropy' */
    method?: 'regex' | 'entropy';
    /** Match span in scanned text (for DLP redaction). */
    start?: number;
    end?: number;
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
    /** Resolved LLM model id used for pricing/counting */
    modelId?: string;
    /** Provider inferred from model id (openai, anthropic, google, unknown) */
    provider?: string;
    /**
     * actual — measured tokens/cost from proxy call_records;
     * model-only — resolved model + list rates, zero recorded traffic;
     * estimated — simulated tools/list (MASTYF_AI_COST_ALLOW_ESTIMATES=true only);
     * none — no model or connectivity
     */
    costSource?: 'actual' | 'model-only' | 'estimated' | 'none';
    /** False when model rates could not be resolved */
    priced?: boolean;
    /** USD per 1M input tokens (model-only / pricing preview) */
    listInputPerM?: number;
    /** USD per 1M output tokens (model-only / pricing preview) */
    listOutputPerM?: number;
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
    successRate: number;
    contextPressure: number;
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
    /** Stable MCP server id (defaults to serverName). Schema v2 receipts bind this. */
    serverId?: string;
    clientName?: string;
    commandDigest?: string;
    commandArgs?: string[];
    childStdinBytes?: number | null;
    sessionId?: string;
    toolName: string;
    requestTokens: number;
    responseTokens: number;
    totalTokens: number;
    durationMs: number;
    timestamp: string;
    /** LLM model billed for this call (detected at proxy time) */
    model?: string;
    /** USD cost from client or live provider rates. Null means pricing was unavailable. */
    costUsd?: number | null;
    pricingSource?: PricingSource;
    priced?: boolean;
    pricingUnavailable?: string;
    /** True when the proxy denied the call (policy, DLP, auth) before upstream responded */
    blocked?: boolean;
    blockRule?: string;
    blockReason?: string;
    /** Layer votes from gateway /v1/decide when available */
    cbacDecision?: 'ALLOW' | 'DENY';
    difcDecision?: 'ALLOW' | 'DENY';
    aiaDecision?: 'ALLOW' | 'DENY' | 'NOT_EVALUATED';
    /** Decide/evaluate latency from /v1/decide when the arbiter ran */
    totalLatencyMs?: number;
    /** JSON-RPC or shield request id — required to join decide latency + ledger request_id */
    requestId?: string;
    /** W3C / OTel trace id captured while the request span is still active */
    traceId?: string;
    /** Redacted argument snippet for audit (encrypted at rest when MASTYF_AI_DB_ENCRYPT_AUDIT_ARGS=true) */
    argumentSnippet?: string;
    /** Whether token counts came from provider API usage or local estimate */
    tokenSource?: 'api' | 'estimated';
    /** Multi-tenant isolation label */
    tenantId?: string;
    /** Unified spend pool reservation id for commit/release */
    spendReservationId?: string;
}
//# sourceMappingURL=types.d.ts.map