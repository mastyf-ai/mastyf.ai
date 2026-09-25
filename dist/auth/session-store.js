/**
 * Server-side (DB-backed) sessions for the dashboard.
 *
 * Session tokens are opaque, high-entropy random values. Only a SHA-256
 * hash of the token is ever persisted — the plaintext token lives solely
 * in the browser's httpOnly cookie — so a database compromise alone does
 * not allow session hijacking. Each session also carries its own CSRF
 * secret, used for double-submit-cookie CSRF protection.
 */
import { randomBytes, createHash } from 'crypto';
import { getAuthDb } from './db/auth-db.js';
function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}
function rowToSession(row, currentSessionId) {
    return {
        id: String(row['id']),
        userId: String(row['user_id']),
        ipAddress: row['ip_address'] ?? null,
        userAgent: row['user_agent'] ?? null,
        createdAt: String(row['created_at']),
        lastSeenAt: String(row['last_seen_at']),
        expiresAt: String(row['expires_at']),
        current: currentSessionId ? String(row['id']) === currentSessionId : undefined,
    };
}
export const sessionStore = {
    async create(params) {
        const db = await getAuthDb();
        const id = db.newId();
        const token = randomBytes(32).toString('base64url');
        const csrfSecret = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + params.ttlMinutes * 60_000).toISOString();
        const now = db.nowIso();
        await db.run(`INSERT INTO auth_sessions
        (id, tenant_id, user_id, token_hash, csrf_secret, ip_address, user_agent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            id,
            params.tenantId ?? 'default',
            params.userId,
            hashToken(token),
            csrfSecret,
            params.ipAddress ?? null,
            params.userAgent ?? null,
            now,
            now,
            expiresAt,
        ]);
        return { sessionId: id, token, csrfSecret, expiresAt };
    },
    /** Validate a raw cookie token; returns the session row (with sliding-window touch) or null. */
    async validate(token) {
        const db = await getAuthDb();
        const row = await db.get('SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL', [hashToken(token)]);
        if (!row)
            return null;
        if (new Date(String(row['expires_at'])).getTime() <= Date.now()) {
            return null;
        }
        // Sliding expiry touch — update last_seen_at (not expires_at; absolute
        // timeout is enforced by expires_at set at creation time).
        await db.run('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?', [db.nowIso(), row['id']]);
        return { ...rowToSession(row), csrfSecret: String(row['csrf_secret']), userId: String(row['user_id']) };
    },
    async revoke(sessionId) {
        const db = await getAuthDb();
        await db.run('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?', [db.nowIso(), sessionId]);
    },
    async revokeByToken(token) {
        const db = await getAuthDb();
        await db.run('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?', [db.nowIso(), hashToken(token)]);
    },
    async revokeAllForUser(userId, exceptSessionId) {
        const db = await getAuthDb();
        if (exceptSessionId) {
            await db.run('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL', [
                db.nowIso(),
                userId,
                exceptSessionId,
            ]);
        }
        else {
            await db.run('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
                db.nowIso(),
                userId,
            ]);
        }
    },
    async listForUser(userId, currentSessionId) {
        const db = await getAuthDb();
        const rows = await db.all(`SELECT * FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY last_seen_at DESC`, [userId, db.nowIso()]);
        return rows.map((r) => rowToSession(r, currentSessionId));
    },
    async findById(sessionId) {
        const db = await getAuthDb();
        const row = await db.get('SELECT * FROM auth_sessions WHERE id = ?', [sessionId]);
        return row ? rowToSession(row) : null;
    },
};
//# sourceMappingURL=session-store.js.map