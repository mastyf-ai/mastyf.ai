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
  /** Tool name allowlist — if specified, only these tools are permitted */
  tools?: {
    allow?: string[];
    deny?: string[];
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
  /** Max calls per minute per server */
  maxCallsPerMinute?: number;
  /** v0.5.1: RBAC — scope and client_id constraints */
  rbac?: {
    /** Required scopes the agent must have */
    scopes?: string[];
    /** Allowed client IDs (regex patterns supported) */
    clientIds?: string[];
  };
}

export interface PolicyConfig {
  version: string;
  policy: {
    mode: PolicyMode;
    /** GAP 14: default_action when no rule matches. 'allow' = fail-open, 'block' = fail-closed */
    default_action?: PolicyAction;
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
  /** v0.5.1: Agent identity from OAuth (for RBAC) */
  agentIdentity?: import('../auth/auth-types.js').AgentIdentity;
}
