/**
 * MCP Lifecycle Guard — intercepts MCP protocol messages at the proxy layer
 * to enforce per-method policies and provide protocol-level audit.
 *
 * Features:
 *   - Allow `initialize` without authentication (configurable)
 *   - Enforce different policies per MCP method type
 *   - Track MCP protocol state per session
 *   - Full lifecycle audit trail
 */
import { randomBytes } from 'crypto';
import { Logger } from '../../utils/logger.js';

export type McpMethod =
  | 'initialize' | 'initialized' | 'ping'
  | 'tools/list' | 'tools/call'
  | 'resources/list' | 'resources/read' | 'resources/templates/list'
  | 'prompts/list' | 'prompts/get'
  | 'logging/setLevel'
  | 'notifications/initialized' | 'notifications/cancelled';

export interface LifecyclePolicy {
  /** MCP methods allowed for unauthenticated connections */
  unauthenticatedMethods: McpMethod[];
  /** Per-method permission tiers */
  methodTiers: Record<McpMethod, 'open' | 'readonly' | 'standard' | 'admin'>;
  /** Whether to audit every lifecycle event */
  auditAll: boolean;
  /** Maximum concurrent sessions */
  maxSessions: number;
  /** Session timeout in ms */
  sessionTimeoutMs: number;
}

export interface McpSession {
  sessionId: string;
  clientId: string;
  connectedAt: string;
  lastActivity: string;
  initialized: boolean;
  protocolVersion?: string;
  serverInfo?: { name: string; version: string };
  capabilities?: Record<string, unknown>;
  authenticated: boolean;
  authenticatedUserId?: string;
  requestCount: number;
  blockedCount: number;
}

export interface LifecycleEvent {
  timestamp: string;
  sessionId: string;
  method: McpMethod;
  action: 'allowed' | 'blocked' | 'initialized' | 'terminated';
  details: string;
  toolName?: string;
  argsSummary?: string;
  latencyMs?: number;
  userId?: string;
}

const DEFAULT_POLICY: LifecyclePolicy = {
  unauthenticatedMethods: ['initialize', 'ping'],
  methodTiers: {
    'initialize': 'open',
    'initialized': 'open',
    'ping': 'open',
    'tools/list': 'readonly',
    'tools/call': 'standard',
    'resources/list': 'readonly',
    'resources/read': 'standard',
    'resources/templates/list': 'readonly',
    'prompts/list': 'readonly',
    'prompts/get': 'standard',
    'logging/setLevel': 'admin',
    'notifications/initialized': 'open',
    'notifications/cancelled': 'open',
  },
  auditAll: true,
  maxSessions: 1000,
  sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
};

export class McpLifecycleGuard {
  private sessions = new Map<string, McpSession>();
  private events: LifecycleEvent[] = [];
  private policy: LifecyclePolicy;
  private totalRequests = 0;
  private totalBlocked = 0;

  constructor(policy?: Partial<LifecyclePolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  /** Register a new MCP session (on initialize). */
  registerSession(clientId: string, protocolVersion?: string): McpSession {
    // Enforce max sessions
    if (this.sessions.size >= this.policy.maxSessions) {
      const oldest = [...this.sessions.values()]
        .sort((a, b) => new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime())[0];
      if (oldest) {
        this.terminateSession(oldest.sessionId, 'max_sessions_exceeded');
      }
    }

    const session: McpSession = {
      sessionId: `mcp-${Date.now()}-${randomBytes(6).toString('hex')}`,
      clientId,
      connectedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      initialized: false,
      protocolVersion,
      authenticated: false,
      requestCount: 0,
      blockedCount: 0,
    };

    this.sessions.set(session.sessionId, session);
    Logger.info(`[LifecycleGuard] New session: ${session.sessionId} (client: ${clientId})`);
    return session;
  }

  /** Mark a session as initialized (post-handshake). */
  markInitialized(sessionId: string, serverInfo?: { name: string; version: string }, capabilities?: Record<string, unknown>): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.initialized = true;
    s.serverInfo = serverInfo;
    s.capabilities = capabilities;
    s.lastActivity = new Date().toISOString();
    this.recordEvent(sessionId, 'initialize', 'initialized', `Protocol v${s.protocolVersion || 'unknown'}, server: ${serverInfo?.name || 'unknown'}`);
    return true;
  }

  /** Check if a method is allowed for the given session state. */
  checkAccess(
    sessionId: string,
    method: McpMethod,
    authenticated: boolean,
    userTier: 'open' | 'readonly' | 'standard' | 'admin' = 'standard',
  ): { allowed: boolean; reason?: string } {
    const s = this.sessions.get(sessionId);
    if (!s) {
      // Allow initialize without a session
      if (method === 'initialize') return { allowed: true };
      return { allowed: false, reason: `No active session — initialize first` };
    }

    // Check session timeout
    const lastActivity = new Date(s.lastActivity).getTime();
    if (Date.now() - lastActivity > this.policy.sessionTimeoutMs) {
      this.terminateSession(sessionId, 'session_timeout');
      return { allowed: false, reason: 'Session timed out' };
    }

    // Allow unauthenticated methods without auth check
    if (!authenticated && this.policy.unauthenticatedMethods.includes(method)) {
      s.lastActivity = new Date().toISOString();
      return { allowed: true };
    }

    // If not authenticated and method requires auth
    if (!authenticated && !this.policy.unauthenticatedMethods.includes(method)) {
      return { allowed: false, reason: `Authentication required for ${method}` };
    }

    // Check method tier
    const requiredTier = this.policy.methodTiers[method] || 'standard';
    const tierLevels = { open: 0, readonly: 1, standard: 2, admin: 3 };
    if (tierLevels[userTier] < tierLevels[requiredTier]) {
      return { allowed: false, reason: `Method ${method} requires ${requiredTier} tier, user has ${userTier}` };
    }

    s.lastActivity = new Date().toISOString();
    return { allowed: true };
  }

  /** Record an MCP request through the lifecycle guard. */
  recordRequest(
    sessionId: string,
    method: McpMethod,
    blocked: boolean,
    toolName?: string,
    argsSummary?: string,
    latencyMs?: number,
    userId?: string,
  ): void {
    this.totalRequests++;
    const s = this.sessions.get(sessionId);
    if (s) {
      s.requestCount++;
      if (blocked) {
        s.blockedCount++;
        this.totalBlocked++;
      }
    }

    if (this.policy.auditAll) {
      this.recordEvent(sessionId, method, blocked ? 'blocked' : 'allowed',
        `${method} ${toolName ? `(${toolName})` : ''} ${blocked ? 'BLOCKED' : 'allowed'} ${argsSummary ? `args: ${argsSummary.slice(0, 100)}` : ''}`,
        toolName, argsSummary, latencyMs, userId);
    }

    // Trim events to prevent unbounded growth
    if (this.events.length > 10000) {
      this.events = this.events.slice(-5000);
    }
  }

  /** Terminate a session. */
  terminateSession(sessionId: string, reason: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    this.recordEvent(sessionId, 'notifications/cancelled' as McpMethod, 'terminated', reason);
    this.sessions.delete(sessionId);
    Logger.info(`[LifecycleGuard] Terminated session ${sessionId}: ${reason}`);
    return true;
  }

  /** Get lifecycle audit events. */
  getEvents(limit: number = 100): LifecycleEvent[] {
    return this.events.slice(-limit).reverse();
  }

  /** Get active sessions. */
  getActiveSessions(): McpSession[] {
    return [...this.sessions.values()];
  }

  /** Get lifecycle statistics. */
  getStats(): {
    activeSessions: number;
    totalRequests: number;
    totalBlocked: number;
    totalEvents: number;
  } {
    return {
      activeSessions: this.sessions.size,
      totalRequests: this.totalRequests,
      totalBlocked: this.totalBlocked,
      totalEvents: this.events.length,
    };
  }

  private recordEvent(
    sessionId: string,
    method: McpMethod,
    action: LifecycleEvent['action'],
    details: string,
    toolName?: string,
    argsSummary?: string,
    latencyMs?: number,
    userId?: string,
  ): void {
    this.events.push({
      timestamp: new Date().toISOString(),
      sessionId,
      method,
      action,
      details,
      toolName,
      argsSummary,
      latencyMs,
      userId,
    });
  }
}