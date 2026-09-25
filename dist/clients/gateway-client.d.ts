/**
 * Canonical Mastyf Gateway Client for mastyf.ai
 *
 * Implements the authoritative integration boundary between mastyf.ai and Mastyf Gateway.
 * Key invariants:
 * 1. Authoritative Projection: mastyf.ai is a projection of Gateway truth, never an independent authority.
 * 2. Strict Schema Validation: All responses are strictly validated at runtime. Malformed or invalid
 *    payloads produce GATEWAY_STATE_UNAVAILABLE errors.
 * 3. Contract Versioning: Asserts compatible control_api_version ("1.0").
 * 4. Token Isolation: Reads local control token from ~/.mastyf/control_token (mode 0600) on the server side.
 * 5. Explicit Mutation Invariant: Mutating methods mandate confirmation: true to set X-Mastyf-Authorization.
 */
export declare const SUPPORTED_CONTROL_API_VERSION = "1.0";
export declare class GatewayError extends Error {
    readonly code: string;
    readonly statusCode?: number;
    readonly details?: unknown;
    constructor(message: string, code?: string, statusCode?: number, details?: unknown);
}
export declare class GatewayUnavailableError extends GatewayError {
    constructor(message?: string, details?: unknown);
}
export declare class GatewayVersionMismatchError extends GatewayError {
    constructor(expected: string, actual: string);
}
export interface GatewayStatus {
    status: string;
    control_api_version: string;
    gateway_version: string;
    contract_revision: string;
    environment_state: 'PROTECTED' | 'PARTIAL' | 'UNPROTECTED' | 'FAILED' | 'UNKNOWN';
    current_generation: number;
    policy: {
        id: string;
        version: string;
        hash: string;
        description: string;
    };
    servers_count: number;
    ledger: {
        chain_integrity: boolean;
        total_receipts: number;
        zero_byte_enforcements: number;
    };
    intelligence: {
        tier: string;
        name: string;
        guard_pro_active: boolean;
        entitlement: string;
        fallback_active: boolean;
        fallback_reason: string | null;
    };
}
export interface ClientProtectionReport {
    client: string;
    config_path: string;
    exists: boolean;
    total_servers: number;
    mediated_servers: number;
    unmediated_servers: number;
    unmediated_names: string[];
    status: string;
}
export interface ProtectionReport {
    result: 'PROTECTED' | 'PARTIAL' | 'UNPROTECTED' | 'FAILED';
    status: string;
    clients: ClientProtectionReport[];
    total_servers: number;
    total_mediated: number;
    total_unmediated: number;
    is_protected: boolean;
    summary: string;
}
export interface DiscoveredTool {
    name: string;
    description: string;
    security_class: string;
    /** JSON Schema from live tools/list (may be empty object). */
    input_schema?: Record<string, unknown>;
    inputSchema?: Record<string, unknown>;
}
export interface DiscoveredServer {
    name: string;
    client: string;
    command: string;
    args: string[];
    tools_count: number;
    tools: DiscoveredTool[];
    resources?: Array<{
        uri: string;
        name: string;
        description?: string;
        mimeType?: string;
    }>;
    resources_status?: string;
    transport?: string;
    status?: string;
    tools_status?: string;
    source?: string;
}
export interface ProtectionPlanTarget {
    name: string;
    client: string;
    original_command: string;
    original_args: string[];
    proposed_command: string;
    proposed_args: string[];
    action: string;
}
export interface ProtectionPlan {
    plan_id: string;
    created_at: number;
    environment_generation: number;
    policy_hash: string;
    server_fingerprint: string;
    targets: ProtectionPlanTarget[];
    total_mutations: number;
}
export interface ApplyResult {
    status: string;
    plan_id: string;
    new_generation: number;
    receipt_id: string;
    verification: ProtectionReport;
}
export interface RollbackResult {
    status: string;
    target_generation: number;
    current_generation: number;
    receipt_id: string;
    verification: ProtectionReport;
}
export interface PolicyReport {
    active_hash: string;
    policy_yaml: string;
    valid: boolean;
    rules_count: number;
    warnings: string[];
}
export interface PolicyProposeResult {
    intent: string;
    proposed_yaml: string;
    explanation: string;
    valid: boolean;
    diff: string;
}
export interface PolicyActivateResult {
    status: string;
    policy_hash: string;
    receipt_id: string;
    rules_count: number;
}
export interface Receipt {
    receipt_id: string;
    timestamp: string;
    tool_name: string;
    server_name: string;
    server_id?: string;
    client_name?: string;
    command_digest?: string;
    child_stdin_bytes?: number | null;
    decision: 'ALLOW' | 'BLOCK' | 'ESCALATE';
    enforcement_reason: string;
    caller_agent: string;
    payload_sha256: string;
}
export interface ReceiptsPage {
    total: number;
    total_receipts?: number;
    limit: number;
    cursor: string | null;
    offset?: number;
    receipts: Receipt[];
}
export interface ServerTelemetryStat {
    server_id: string;
    server_name: string;
    client_name?: string | null;
    command_digest?: string | null;
    total: number;
    allowed: number;
    blocked: number;
    escalated: number;
    zero_byte_enforcements: number;
    last_tool?: string | null;
    last_timestamp?: string | null;
    last_decision?: string | null;
}
export interface ServerStatsPage {
    total_servers: number;
    servers: ServerTelemetryStat[];
}
export interface ControlReceipt {
    receipt_id: string;
    timestamp: string;
    action: string;
    generation: number;
    policy_hash: string;
    plan_id: string | null;
    operator: string;
    signature: string;
}
export interface ControlReceiptsPage {
    total: number;
    limit: number;
    cursor: string | null;
    receipts: ControlReceipt[];
}
export interface DecisionExplanation {
    receipt_id: string;
    tool_name: string;
    server_name: string;
    decision: string;
    reason: string;
    rule_id: string | null;
    intelligence_assessment: {
        provider_tier: string;
        model_name: string;
        confidence: number;
        recommended_action: string;
        reason: string;
    } | null;
    explanation: string;
}
export interface MastyfGatewayClientConfig {
    baseUrl?: string;
    token?: string;
    timeoutMs?: number;
}
export declare class MastyfGatewayClient {
    private readonly baseUrl;
    private token;
    private readonly timeoutMs;
    constructor(config?: MastyfGatewayClientConfig);
    /**
     * Lazily loads token from local ~/.mastyf/control_token file if not explicitly supplied.
     */
    private getOrLoadToken;
    private request;
    /**
     * Fetches authoritative Gateway environment status, validating contract version.
     */
    status(): Promise<GatewayStatus>;
    /**
     * Fetches canonical ProtectionVerificationReport across all client environments.
     */
    protection(): Promise<ProtectionReport>;
    /**
     * Returns discovered MCP servers and classified tools.
     */
    servers(): Promise<DiscoveredServer[]>;
    /**
     * Per-MCP allow/block/escalate aggregates from the execution ledger.
     */
    serverStats(): Promise<ServerStatsPage>;
    /**
     * Paginated receipts for one MCP server identity.
     */
    serverReceipts(serverId: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<ReceiptsPage>;
    /**
     * Posture summary for one MCP server (discovery + live telemetry).
     */
    serverPosture(serverId: string): Promise<Record<string, unknown>>;
    /**
     * Returns active policy details and validation.
     */
    policy(): Promise<PolicyReport>;
    /**
     * Fetches execution receipts audit log.
     */
    receipts(options?: {
        limit?: number;
        cursor?: string;
        offset?: number;
        serverId?: string;
        serverName?: string;
    }): Promise<ReceiptsPage>;
    /**
     * Time-window decision aggregates from the live execution ledger.
     */
    receiptStats(options?: {
        window?: string;
        since?: string;
        until?: string;
    }): Promise<Record<string, unknown>>;
    /**
     * Fetches control receipts audit log.
     */
    controlReceipts(options?: {
        limit?: number;
        cursor?: string;
        offset?: number;
    }): Promise<ControlReceiptsPage>;
    /**
     * Pre-flights a typed and fingerprinted ProtectionPlan without mutating configuration.
     */
    protectionPlan(request?: {
        serverNames?: string[];
    }): Promise<ProtectionPlan>;
    /**
     * Atomically executes a previously planned ProtectionPlan.
     * Mandates explicit confirmation boolean.
     */
    protectionApply(plan: ProtectionPlan, confirmation: boolean): Promise<ApplyResult>;
    /**
     * Rolls back configuration to a previous snapshot generation.
     * Mandates explicit confirmation boolean.
     */
    rollback(targetGeneration?: number, confirmation?: boolean): Promise<RollbackResult>;
    /**
     * Proposes policy modifications using the PolicyAssistant without activating them.
     */
    policyPropose(intent: string): Promise<PolicyProposeResult>;
    /**
     * Activates a validated policy YAML.
     * Mandates explicit confirmation boolean.
     */
    policyActivate(policyYaml: string, confirmation: boolean): Promise<PolicyActivateResult>;
    /**
     * Executes static and dynamic analysis scan on MCP servers.
     */
    scan(serverNames?: string[]): Promise<any>;
    /**
     * Explains the deterministic and intelligence factors for a specific decision.
     */
    explainDecision(receiptId: string): Promise<DecisionExplanation>;
    /** Immutable deployment artifact identity from the control plane. */
    deploymentManifest(): Promise<Record<string, unknown>>;
    /** Live canary self-test (can take >8s — uses extended timeout). */
    selfTest(body?: {
        force_fail_case_id?: number;
    }): Promise<Record<string, unknown>>;
    /** Open SSE event stream against the control plane (server-side only). */
    openEventStream(afterSequence?: number): Promise<Response>;
    /** Open / resolved escalation queue. */
    escalations(status?: 'open' | 'resolved' | 'all'): Promise<Record<string, unknown>>;
    /**
     * Resolve an escalated receipt with OS4 approval grammar.
     * Actions: allow_once | session | similar | destination | tool | block | quarantine
     * (aliases: allow, allow_similar). Always finite expires_at.
     */
    resolveEscalation(request: {
        receiptId: string;
        action: 'allow' | 'allow_once' | 'allow_always' | 'block' | 'block_permanently' | 'permanent_block' | 'allow_similar' | 'similar' | 'session' | 'destination' | 'tool' | 'quarantine';
        confirmation: boolean;
        remainingUses?: number;
        ttlSeconds?: number;
        expiresAt?: number;
        scopeDetails?: string;
        destination?: string;
        sessionId?: string;
        operator?: string;
    }): Promise<Record<string, unknown>>;
    /** Active lockdown / safe-mode / kill controls. */
    lockdownState(): Promise<Record<string, unknown>>;
    lockdownApply(body: {
        mode: string;
        scope: string;
        target?: string;
        reason?: string;
        ttlSeconds?: number;
        expiresAt?: number;
        operator?: string;
    }): Promise<Record<string, unknown>>;
    lockdownRelease(controlId: string, operator?: string): Promise<Record<string, unknown>>;
    continuousVerification(): Promise<Record<string, unknown>>;
    driftClasses(): Promise<Record<string, unknown>>;
    activityTimeline(limit?: number): Promise<Record<string, unknown>>;
    operatorGrants(limit?: number): Promise<Record<string, unknown>>;
    toolPins(): Promise<Record<string, unknown>>;
    checkToolPin(serverId: string, tools: unknown[]): Promise<Record<string, unknown>>;
    attackLabOwasp(): Promise<Record<string, unknown>>;
    sandboxObserveStatus(): Promise<Record<string, unknown>>;
    /** Authoritative dry-run / evaluate decide path. */
    decide(body: Record<string, unknown>): Promise<Record<string, unknown>>;
    /** Single receipt by id. */
    receiptById(receiptId: string): Promise<Record<string, unknown>>;
    /** Full action trace for a receipt when available. */
    receiptTrace(receiptId: string): Promise<Record<string, unknown>>;
    /** Conversational agent turn mediated by Mastyf Gateway. */
    agentChat(body: {
        message: string;
        sessionId?: string;
        principalId?: string;
        mock?: boolean;
    }): Promise<{
        session_id: string;
        reply: string;
        tool_events: Array<{
            tool_name: string;
            tool_args: Record<string, unknown>;
            decision: string;
            reason_code: string;
            rule_violated: string | null;
            bytes_dispatched: number;
            receipt_hash: string | null;
            latency_ms: number | null;
            execution_certainty: string;
        }>;
        model_name: string;
    }>;
}
//# sourceMappingURL=gateway-client.d.ts.map