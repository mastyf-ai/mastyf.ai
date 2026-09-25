/**
 * Agent-to-Agent Trust Negotiation Protocol — enables automated trust
 * handshakes between AI agents behind separate Mastyf AI instances.
 *
 * Protocol flow:
 *   1. Capability Exchange — agents share attested capabilities and constraints
 *   2. Policy Negotiation — negotiate minimal-trust parameters
 *   3. Session Establishment — create ephemeral, scoped sessions with auto-expiry
 *   4. Audit Logging — full negotiation trail for compliance
 */
export interface AgentIdentity {
    /** Agent's unique identifier */
    agentId: string;
    /** The Mastyf AI instance protecting this agent */
    mastyfAiInstance: string;
    /** Agent's declared capabilities */
    capabilities: string[];
    /** Attestation proof (JWT/signed) */
    attestation?: string;
}
export interface TrustPolicy {
    /** Allowed tools for the remote agent */
    allowedTools: string[];
    /** Maximum call rate per minute */
    maxRatePerMin: number;
    /** Scope of access (file paths, DB tables, etc.) */
    scope: Record<string, string[]>;
    /** Session TTL in ms */
    sessionTtlMs: number;
    /** Whether audit logging is required */
    requireAudit: boolean;
}
export interface TrustSession {
    /** Unique session id */
    sessionId: string;
    /** The remote agent */
    remoteAgent: AgentIdentity;
    /** Negotiated trust policy */
    policy: TrustPolicy;
    /** Session start time */
    startedAt: string;
    /** Session expiry time */
    expiresAt: string;
    /** Whether the session is active */
    active: boolean;
    /** Call count for rate limiting */
    callCount: number;
    /** Audit trail */
    auditTrail: NegotiationAuditEntry[];
}
export interface NegotiationAuditEntry {
    timestamp: string;
    event: 'handshake_start' | 'capability_exchange' | 'policy_negotiation' | 'session_established' | 'session_expired' | 'session_revoked' | 'rate_limit_exceeded';
    details: string;
    metadata?: Record<string, unknown>;
}
export interface NegotiationResult {
    success: boolean;
    sessionId?: string;
    negotiatedPolicy?: TrustPolicy;
    error?: string;
    /** The negotiation decision with rationale */
    rationale: string;
    /** Full audit trail of the negotiation */
    audit: NegotiationAuditEntry[];
}
export declare class TrustNegotiationProtocol {
    private activeSessions;
    private trustRegistry;
    private totalNegotiations;
    private failedNegotiations;
    /**
     * Initiate a trust negotiation with a remote agent.
     */
    negotiate(localAgent: AgentIdentity, remoteAgent: AgentIdentity, request: {
        requestedTools: string[];
        scope: Record<string, string[]>;
        maxSessionMinutes: number;
    }): NegotiationResult;
    /**
     * Negotiate a trust policy based on both agents' constraints.
     */
    private negotiatePolicy;
    /**
     * Check if an agent is in the trust registry.
     */
    private isAgentTrusted;
    /**
     * Register an agent in the trust registry.
     */
    registerAgent(agent: AgentIdentity): void;
    /**
     * Check if a tool call is allowed within a trust session.
     */
    checkAccess(sessionId: string, toolName: string): {
        allowed: boolean;
        reason: string;
    };
    /**
     * Revoke an active trust session.
     */
    revokeSession(sessionId: string): boolean;
    /**
     * Get all active trust sessions.
     */
    getActiveSessions(): TrustSession[];
    /**
     * Get the trust registry.
     */
    getTrustRegistry(): AgentIdentity[];
    /**
     * Remove an agent from the trust registry.
     */
    unregisterAgent(agentId: string): boolean;
    /**
     * Get negotiation statistics.
     */
    getStats(): {
        totalNegotiations: number;
        failedNegotiations: number;
        activeSessions: number;
        registeredAgents: number;
    };
}
//# sourceMappingURL=protocol.d.ts.map