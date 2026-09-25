import { getAuthDb } from './db/auth-db.js';
import { hashPassword } from './password.js';
function rowToUser(row) {
    return {
        id: String(row['id']),
        tenantId: String(row['tenant_id']),
        username: String(row['username']),
        email: String(row['email']),
        displayName: String(row['display_name']),
        status: row['status'],
        mustChangePassword: !!row['must_change_password'],
        failedLoginCount: Number(row['failed_login_count'] ?? 0),
        lockedUntil: row['locked_until'] ?? null,
        lastLoginAt: row['last_login_at'] ?? null,
        lastLoginIp: row['last_login_ip'] ?? null,
        passwordChangedAt: String(row['password_changed_at']),
        createdAt: String(row['created_at']),
        updatedAt: String(row['updated_at']),
        createdBy: row['created_by'] ?? null,
    };
}
export const userStore = {
    async countAll(tenantId = 'default') {
        const db = await getAuthDb();
        const row = await db.get('SELECT COUNT(*) as c FROM auth_users WHERE tenant_id = ?', [tenantId]);
        return Number(row?.['c'] ?? 0);
    },
    async create(input) {
        const db = await getAuthDb();
        const id = db.newId();
        const tenantId = input.tenantId ?? 'default';
        const passwordHash = await hashPassword(input.password);
        const now = db.nowIso();
        await db.run(`INSERT INTO auth_users
        (id, tenant_id, username, email, display_name, password_hash, status,
         must_change_password, failed_login_count, password_changed_at,
         created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`, [
            id,
            tenantId,
            input.username,
            input.email,
            input.displayName,
            passwordHash,
            input.status ?? 'active',
            input.mustChangePassword ? 1 : 0,
            now,
            now,
            now,
            input.createdBy ?? null,
        ]);
        const row = await db.get('SELECT * FROM auth_users WHERE id = ?', [id]);
        return rowToUser(row);
    },
    async findById(id, tenantId = 'default') {
        const db = await getAuthDb();
        const row = await db.get('SELECT * FROM auth_users WHERE id = ? AND tenant_id = ?', [id, tenantId]);
        return row ? rowToUser(row) : null;
    },
    async findByUsername(username, tenantId = 'default') {
        const db = await getAuthDb();
        const row = await db.get('SELECT * FROM auth_users WHERE username = ? AND tenant_id = ?', [username, tenantId]);
        return row ? rowToUser(row) : null;
    },
    async findByUsernameOrEmail(identifier, tenantId = 'default') {
        const db = await getAuthDb();
        const row = await db.get('SELECT * FROM auth_users WHERE (username = ? OR email = ?) AND tenant_id = ?', [identifier, identifier, tenantId]);
        return row ? rowToUser(row) : null;
    },
    /** Internal — includes password_hash, only for the login/verify path. */
    async findByUsernameOrEmailWithHash(identifier, tenantId = 'default') {
        const db = await getAuthDb();
        const row = await db.get('SELECT * FROM auth_users WHERE (username = ? OR email = ?) AND tenant_id = ?', [identifier, identifier, tenantId]);
        if (!row)
            return null;
        return { ...rowToUser(row), passwordHash: String(row['password_hash']) };
    },
    async list(tenantId = 'default') {
        const db = await getAuthDb();
        const rows = await db.all('SELECT * FROM auth_users WHERE tenant_id = ? ORDER BY created_at DESC', [tenantId]);
        return rows.map(rowToUser);
    },
    async update(id, input, tenantId = 'default') {
        const db = await getAuthDb();
        const existing = await this.findById(id, tenantId);
        if (!existing)
            return null;
        await db.run(`UPDATE auth_users SET email = ?, display_name = ?, status = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`, [
            input.email ?? existing.email,
            input.displayName ?? existing.displayName,
            input.status ?? existing.status,
            db.nowIso(),
            id,
            tenantId,
        ]);
        return this.findById(id, tenantId);
    },
    async delete(id, tenantId = 'default') {
        const db = await getAuthDb();
        const result = await db.run('DELETE FROM auth_users WHERE id = ? AND tenant_id = ?', [id, tenantId]);
        return result.changes > 0;
    },
    async setPassword(id, plaintext, mustChangePassword = false) {
        const db = await getAuthDb();
        const hash = await hashPassword(plaintext);
        await db.run(`UPDATE auth_users SET password_hash = ?, password_changed_at = ?, must_change_password = ?,
        failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`, [hash, db.nowIso(), mustChangePassword ? 1 : 0, db.nowIso(), id]);
    },
    async setMustChangePassword(id, mustChange) {
        const db = await getAuthDb();
        await db.run('UPDATE auth_users SET must_change_password = ?, updated_at = ? WHERE id = ?', [
            mustChange ? 1 : 0,
            db.nowIso(),
            id,
        ]);
    },
    async setStatus(id, status) {
        const db = await getAuthDb();
        await db.run('UPDATE auth_users SET status = ?, updated_at = ? WHERE id = ?', [status, db.nowIso(), id]);
    },
    async recordFailedLogin(id, lockoutThreshold, lockoutMinutes) {
        const db = await getAuthDb();
        const row = await db.get('SELECT failed_login_count FROM auth_users WHERE id = ?', [id]);
        const nextCount = Number(row?.['failed_login_count'] ?? 0) + 1;
        const locked = nextCount >= lockoutThreshold;
        if (locked) {
            const lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000).toISOString();
            await db.run(`UPDATE auth_users SET failed_login_count = ?, status = 'locked', locked_until = ?, updated_at = ? WHERE id = ?`, [nextCount, lockedUntil, db.nowIso(), id]);
        }
        else {
            await db.run(`UPDATE auth_users SET failed_login_count = ?, updated_at = ? WHERE id = ?`, [
                nextCount,
                db.nowIso(),
                id,
            ]);
        }
        return { locked };
    },
    async recordSuccessfulLogin(id, ip) {
        const db = await getAuthDb();
        await db.run(`UPDATE auth_users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, last_login_ip = ?, updated_at = ?
       WHERE id = ?`, [db.nowIso(), ip, db.nowIso(), id]);
    },
    async unlock(id) {
        const db = await getAuthDb();
        await db.run(`UPDATE auth_users SET status = 'active', failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`, [db.nowIso(), id]);
    },
    /** True if `lockedUntil` has passed — caller should auto-unlock for a smooth UX. */
    isLockExpired(user) {
        if (user.status !== 'locked' || !user.lockedUntil)
            return false;
        return new Date(user.lockedUntil).getTime() <= Date.now();
    },
};
//# sourceMappingURL=user-store.js.map