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
import { Logger } from '../../utils/logger.js';
export class TrustNegotiationProtocol {
    activeSessions = new Map();
    trustRegistry = new Map();
    totalNegotiations = 0;
    failedNegotiations = 0;
    /**
     * Initiate a trust negotiation with a remote agent.
     */
    negotiate(localAgent, remoteAgent, request) {
        const audit = [];
        this.totalNegotiations++;
        // Stage 1: Capability exchange
        audit.push({
            timestamp: new Date().toISOString(),
            event: 'handshake_start',
            details: `Negotiation initiated between ${localAgent.agentId} and ${remoteAgent.agentId}`,
        });
        const isTrusted = this.isAgentTrusted(remoteAgent);
        audit.push({
            timestamp: new Date().toISOString(),
            event: 'capability_exchange',
            details: `Remote agent capabilities: ${remoteAgent.capabilities.join(', ')}. Trusted: ${isTrusted}`,
        });
        if (!isTrusted && !remoteAgent.attestation) {
            this.failedNegotiations++;
            return {
                success: false,
                error: 'Agent is not in trust registry and no attestation provided',
                rationale: `Agent "${remoteAgent.agentId}" is not trusted. Add it to the trust registry first.`,
                audit,
            };
        }
        // Stage 2: Policy negotiation
        const negotiatedPolicy = this.negotiatePolicy(localAgent, remoteAgent, request);
        audit.push({
            timestamp: new Date().toISOString(),
            event: 'policy_negotiation',
            details: `Negotiated policy: ${negotiatedPolicy.allowedTools.join(', ')} at ${negotiatedPolicy.maxRatePerMin} calls/min`,
        });
        // Validate minimum trust requirements
        if (negotiatedPolicy.allowedTools.length === 0) {
            this.failedNegotiations++;
            return {
                success: false,
                error: 'No tools agreed upon in policy negotiation',
                rationale: 'Negotiation failed — no overlapping tool permissions found.',
                audit,
            };
        }
        // Stage 3: Session establishment
        const sessionId = crypto.randomUUID();
        const now = new Date();
        const session = {
            sessionId,
            remoteAgent,
            policy: negotiatedPolicy,
            startedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + negotiatedPolicy.sessionTtlMs).toISOString(),
            active: true,
            callCount: 0,
            auditTrail: audit,
        };
        this.activeSessions.set(sessionId, session);
        audit.push({
            timestamp: new Date().toISOString(),
            event: 'session_established',
            details: `Session ${sessionId} established — expires in ${negotiatedPolicy.sessionTtlMs / 60000} minutes`,
        });
        Logger.info(`[TrustProtocol] Session ${sessionId} established between ${localAgent.agentId} and ${remoteAgent.agentId}`);
        return {
            success: true,
            sessionId,
            negotiatedPolicy,
            rationale: `Session established with ${negotiatedPolicy.allowedTools.length} allowed tools, rate limit of ${negotiatedPolicy.maxRatePerMin} calls/min, scope defined for ${Object.keys(negotiatedPolicy.scope).length} resources.`,
            audit,
        };
    }
    /**
     * Negotiate a trust policy based on both agents' constraints.
     */
    negotiatePolicy(_local, remote, request) {
        // Apply least-privilege principle:
        // Only allow tools that the remote agent claims to have AND the local agent requests
        const allowedTools = request.requestedTools.filter(t => remote.capabilities.some(cap => cap.toLowerCase().includes(t.toLowerCase()) ||
            t.toLowerCase().includes(cap.toLowerCase())));
        return {
            allowedTools: allowedTools.length > 0 ? allowedTools : ['read_only'],
            maxRatePerMin: Math.min(request.maxSessionMinutes * 2, 60), // Cap at 60 calls/min
            scope: request.scope,
            sessionTtlMs: Math.min(request.maxSessionMinutes * 60_000, 3_600_000), // Max 1 hour
            requireAudit: true,
        };
    }
    /**
     * Check if an agent is in the trust registry.
     */
    isAgentTrusted(agent) {
        return this.trustRegistry.has(agent.agentId);
    }
    /**
     * Register an agent in the trust registry.
     */
    registerAgent(agent) {
        this.trustRegistry.set(agent.agentId, agent);
        Logger.info(`[TrustProtocol] Registered agent: ${agent.agentId}`);
    }
    /**
     * Check if a tool call is allowed within a trust session.
     */
    checkAccess(sessionId, toolName) {
        const session = this.activeSessions.get(sessionId);
        if (!session)
            return { allowed: false, reason: 'Session not found' };
        if (!session.active)
            return { allowed: false, reason: 'Session expired or revoked' };
        if (new Date() > new Date(session.expiresAt)) {
            session.active = false;
            return { allowed: false, reason: 'Session has expired' };
        }
        if (!session.policy.allowedTools.includes(toolName)) {
            return { allowed: false, reason: `Tool "${toolName}" not in negotiated policy` };
        }
        if (session.callCount >= session.policy.maxRatePerMin * 60) {
            return { allowed: false, reason: 'Rate limit exceeded for session' };
        }
        session.callCount++;
        return { allowed: true, reason: 'Access granted' };
    }
    /**
     * Revoke an active trust session.
     */
    revokeSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session)
            return false;
        session.active = false;
        session.auditTrail.push({
            timestamp: new Date().toISOString(),
            event: 'session_revoked',
            details: 'Session manually revoked',
        });
        Logger.info(`[TrustProtocol] Revoked session: ${sessionId}`);
        return true;
    }
    /**
     * Get all active trust sessions.
     */
    getActiveSessions() {
        return [...this.activeSessions.values()].filter(s => s.active);
    }
    /**
     * Get the trust registry.
     */
    getTrustRegistry() {
        return [...this.trustRegistry.values()];
    }
    /**
     * Remove an agent from the trust registry.
     */
    unregisterAgent(agentId) {
        return this.trustRegistry.delete(agentId);
    }
    /**
     * Get negotiation statistics.
     */
    getStats() {
        return {
            totalNegotiations: this.totalNegotiations,
            failedNegotiations: this.failedNegotiations,
            activeSessions: this.getActiveSessions().length,
            registeredAgents: this.trustRegistry.size,
        };
    }
}
//# sourceMappingURL=protocol.js.map