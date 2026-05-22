import { randomUUID } from 'crypto';
import { LRUCache } from 'lru-cache';
import { AgentIdentity } from './auth-types.js';
import { Logger } from '../utils/logger.js';
import { DEFAULT_TENANT_ID } from '../tenant/resolve-tenant.js';

/**
 * Session cache for replay protection.
 * After a JWT is validated once, a short-lived session token is issued.
 * Subsequent calls must include this session token, not the raw JWT.
 * This prevents replay of captured JWTs within their expiry window.
 *
 * In production multi-replica, use RedisSessionCache (REDIS_URL).
 */

export interface SessionEntry {
  token: string;
  identity: AgentIdentity;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}

export interface SessionValidationResult {
  identity: AgentIdentity;
  /** Present when GUARDIAN_SESSION_ROTATE_ON_USE=true and session was validated. */
  rotatedToken?: string;
}

function sessionRotationEnabled(): boolean {
  return process.env['GUARDIAN_SESSION_ROTATE_ON_USE'] === 'true';
}

const SESSION_CACHE_MAX = 10_000;
const NONCE_CACHE_MAX = 50_000;

export class SessionCache {
  private sessions: LRUCache<string, SessionEntry>;
  private usedNonces: LRUCache<string, number>;
  protected readonly sessionTtlMs: number;
  protected readonly nonceTtlMs: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(sessionTtlMs: number = 5 * 60 * 1000, nonceTtlMs: number = 10 * 60 * 1000) {
    this.sessionTtlMs = sessionTtlMs;
    this.nonceTtlMs = nonceTtlMs;
    this.sessions = new LRUCache<string, SessionEntry>({
      max: SESSION_CACHE_MAX,
      ttl: sessionTtlMs,
      updateAgeOnGet: false,
    });
    this.usedNonces = new LRUCache<string, number>({
      max: NONCE_CACHE_MAX,
      ttl: nonceTtlMs,
      updateAgeOnGet: false,
    });
    // Periodic sweep for entries past custom expiresAt (LRU ttl is a backstop)
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
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

  protected scopedSessionKey(tenantId: string, token: string): string {
    return `tenant:${tenantId || DEFAULT_TENANT_ID}:session:${token}`;
  }

  protected scopedNonceKey(tenantId: string, nonce: string): string {
    return `tenant:${tenantId || DEFAULT_TENANT_ID}:nonce:${nonce}`;
  }

  /**
   * Create a session after successful JWT validation.
   * Returns a session token the client must use for subsequent calls.
   */
  createSession(identity: AgentIdentity, jwtNonce?: string, tenantId: string = DEFAULT_TENANT_ID): SessionEntry {
    const nonce = jwtNonce || `${identity.sub}:${Date.now()}:${randomUUID()}`;
    const nonceKey = this.scopedNonceKey(tenantId, nonce);

    if (this.usedNonces.has(nonceKey)) {
      Logger.warn(`[session-cache] Replay detected: nonce ${nonce} (tenant=${tenantId})`);
      throw new Error('Nonce replay detected');
    }
    this.usedNonces.set(nonceKey, Date.now());

    const token = `mcp_guardian_session_${randomUUID()}`;
    const now = Date.now();
    const entry: SessionEntry = {
      token,
      identity,
      nonce,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
    };

    this.sessions.set(this.scopedSessionKey(tenantId, token), entry);
    return entry;
  }

  /**
   * Validate a session token.
   * Returns the agent identity if valid, null if expired/not found.
   */
  validateSession(token: string, tenantId: string = DEFAULT_TENANT_ID): AgentIdentity | null {
    const result = this.validateSessionWithRotation(token, tenantId);
    return result?.identity ?? null;
  }

  /**
   * Validate session and optionally rotate token (L-6).
   * When rotation is enabled, old token is revoked and a new one is issued.
   */
  validateSessionWithRotation(
    token: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): SessionValidationResult | null {
    const key = this.scopedSessionKey(tenantId, token);
    const entry = this.sessions.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(key);
      return null;
    }

    if (!sessionRotationEnabled()) {
      return { identity: entry.identity };
    }

    this.sessions.delete(key);
    const newToken = `mcp_guardian_session_${randomUUID()}`;
    const now = Date.now();
    const rotated: SessionEntry = {
      ...entry,
      token: newToken,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
    };
    this.sessions.set(this.scopedSessionKey(tenantId, newToken), rotated);
    return { identity: entry.identity, rotatedToken: newToken };
  }

  /** Check if a JWT nonce has been used (replay detection). */
  isNonceUsed(nonce: string, tenantId: string = DEFAULT_TENANT_ID): boolean {
    return this.usedNonces.has(this.scopedNonceKey(tenantId, nonce));
  }

  /** Revoke a session (e.g., on logout or suspicious activity). */
  revokeSession(token: string, tenantId: string = DEFAULT_TENANT_ID): void {
    this.sessions.delete(this.scopedSessionKey(tenantId, token));
  }

  protected cleanup(): void {
    const now = Date.now();
    for (const [token, entry] of this.sessions) {
      if (now > entry.expiresAt) {
        this.sessions.delete(token);
      }
    }
  }

  get size(): number {
    return this.sessions.size;
  }
}
