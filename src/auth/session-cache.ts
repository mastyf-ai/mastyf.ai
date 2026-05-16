import { randomUUID } from 'crypto';
import { AgentIdentity } from './auth-types.js';
import { Logger } from '../utils/logger.js';

/**
 * Session cache for replay protection.
 * After a JWT is validated once, a short-lived session token is issued.
 * Subsequent calls must include this session token, not the raw JWT.
 * This prevents replay of captured JWTs within their expiry window.
 *
 * In production, replace with Redis for multi-replica HA.
 */

export interface SessionEntry {
  token: string;
  identity: AgentIdentity;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}

export class SessionCache {
  private sessions: Map<string, SessionEntry> = new Map();
  /** nonce → timestamp (ms) for TTL-based expiry */
  private usedNonces: Map<string, number> = new Map();
  protected readonly sessionTtlMs: number;
  protected readonly nonceTtlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(sessionTtlMs: number = 5 * 60 * 1000, nonceTtlMs: number = 10 * 60 * 1000) {
    this.sessionTtlMs = sessionTtlMs;
    this.nonceTtlMs = nonceTtlMs;
    // Cleanup expired entries every 60s
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /** Dispose of the cleanup timer and clear all state */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.sessions.clear();
    this.usedNonces.clear();
  }

  /**
   * Create a session after successful JWT validation.
   * Returns a session token the client must use for subsequent calls.
   * The JWT cannot be replayed because:
   * 1. We track used nonces (jti or sub+iat)
   * 2. We issue a session token with a short (5min) TTL
   */
  createSession(identity: AgentIdentity, jwtNonce?: string): SessionEntry {
    const nonce = jwtNonce || `${identity.sub}:${Date.now()}:${randomUUID()}`;

    // Prevent nonce replay — reject immediately
    if (this.usedNonces.has(nonce)) {
      Logger.warn(`[session-cache] Replay detected: nonce ${nonce}`);
      throw new Error('Nonce replay detected');
    }
    this.usedNonces.set(nonce, Date.now());

    const token = `mcp_guardian_session_${randomUUID()}`;
    const now = Date.now();
    const entry: SessionEntry = {
      token,
      identity,
      nonce,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
    };

    this.sessions.set(token, entry);
    return entry;
  }

  /**
   * Validate a session token.
   * Returns the agent identity if valid, null if expired/not found.
   */
  validateSession(token: string): AgentIdentity | null {
    const entry = this.sessions.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return entry.identity;
  }

  /**
   * Check if a JWT nonce has been used (replay detection).
   */
  isNonceUsed(nonce: string): boolean {
    return this.usedNonces.has(nonce);
  }

  /**
   * Revoke a session (e.g., on logout or suspicious activity).
   */
  revokeSession(token: string): void {
    this.sessions.delete(token);
  }

  protected cleanup(): void {
    const now = Date.now();
    // Clean expired sessions
    for (const [token, entry] of this.sessions) {
      if (now > entry.expiresAt) {
        this.sessions.delete(token);
      }
    }
    // Clean expired nonces based on nonceTtlMs
    const nonceExpiry = now - this.nonceTtlMs;
    for (const [nonce, timestamp] of this.usedNonces) {
      if (timestamp < nonceExpiry) {
        this.usedNonces.delete(nonce);
      }
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}