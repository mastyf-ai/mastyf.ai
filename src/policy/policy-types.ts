/**
 * Policy types for the MCP Guardian active blocking engine.
 */

export type PolicyAction = 'pass' | 'block' | 'flag';

export type PolicyMode = 'audit' | 'warn' | 'block';

export interface ArgPatternSpec {
  /** Field name to match against ('*' = any argument field) */
  field: string;
  /** Regex patterns — if any match, the rule fires */
  patterns: string[];
}

export interface ToolCategorySpec {
  /** Tool names containing these words are blocked */
  deny: string[];
}

export interface PolicyRule {
  name: string;
  description?: string;
  action: PolicyAction;
  /**
   * Tool scoping for this rule.
   * - `allow`: rule applies only to these tools (does not block other tools).
   * - `enforceAllowlist: true`: legacy behavior — block tools not in `allow`.
   * - `deny`: block listed tools when this rule matches.
   */
  tools?: {
    allow?: string[];
    deny?: string[];
    enforceAllowlist?: boolean;
  };
  /** Regex patterns for blocking malicious tool arguments */
  patterns?: string[];
  /** v2.2: Argument-level field patterns (e.g., block /etc/ in 'path' field) */
  argPatterns?: ArgPatternSpec[];
  /** v2.2: Destructive tool categories (e.g., tools with 'delete' in name) */
  toolCategories?: ToolCategorySpec;
  /** v2.2: Tools exempted from toolCategories deny (by exact name) */
  toolAllowExceptions?: string[];
  /** Max tokens per call */
  maxTokens?: number;
  /** When true, pass decisions from this rule may be stored in policy eval cache. */
  cacheable?: boolean;
  /** Max calls per minute per server */
  maxCallsPerMinute?: number;
  /** Adaptive burst limit — max calls per 10-second window */
  maxCallsPer10Seconds?: number;
  /** v0.5.1: RBAC — scope, client_id, and tenant constraints */
  rbac?: {
    /** Required scopes the agent must have */
    scopes?: string[];
    /** Allowed client IDs (regex patterns supported) */
    clientIds?: string[];
    /** Request must be scoped to one of these tenant ids (multi-tenant gateway) */
    tenants?: string[];
  };
}

export interface PolicyConfig {
  version: string;
  policy: {
    mode: PolicyMode;
    /** When no rule matches: pass (fail-open) or block (zero-trust allowlist). Omitted → pass. */
    default_action?: PolicyAction;
    /** Run semantic shell analysis once per request (default: true) */
    semantic_shell?: boolean;
    /** TR39 confusables + NFKC on tool args (default: true). Set false for international teams. */
    unicode_strict?: boolean;
    /** When true (and OPA_URL set), evaluate OPA/Rego before YAML rules. */
    opa?: boolean;
    rules: PolicyRule[];
  };
}

export interface PolicyDecision {
  action: PolicyAction;
  rule: string;
  reason: string;
}

export interface CallContext {
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  requestId: string | number;
  requestTokens: number;
  timestamp: string;
  /** Multi-tenant isolation — set via GUARDIAN_TENANT_ID or X-Tenant-ID */
  tenantId?: string;
  /** v0.5.1: Agent identity from OAuth (for RBAC) */
  agentIdentity?: import('../auth/auth-types.js').AgentIdentity;
  /** Optional idempotency key from params._meta or HTTP header */
  idempotencyKey?: string;
}
