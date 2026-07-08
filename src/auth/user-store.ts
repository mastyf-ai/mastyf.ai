import { getAuthDb, type AuthDbRow } from './db/auth-db.js';
import { hashPassword } from './password.js';
import type { AuthUser, UserStatus } from './rbac-types.js';

function rowToUser(row: AuthDbRow): AuthUser {
  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    username: String(row['username']),
    email: String(row['email']),
    displayName: String(row['display_name']),
    status: row['status'] as UserStatus,
    mustChangePassword: !!row['must_change_password'],
    failedLoginCount: Number(row['failed_login_count'] ?? 0),
    lockedUntil: (row['locked_until'] as string | null) ?? null,
    lastLoginAt: (row['last_login_at'] as string | null) ?? null,
    lastLoginIp: (row['last_login_ip'] as string | null) ?? null,
    passwordChangedAt: String(row['password_changed_at']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
    createdBy: (row['created_by'] as string | null) ?? null,
  };
}

export interface CreateUserInput {
  tenantId?: string;
  username: string;
  email: string;
  displayName: string;
  password: string;
  status?: UserStatus;
  mustChangePassword?: boolean;
  createdBy?: string | null;
}

export interface UpdateUserInput {
  email?: string;
  displayName?: string;
  status?: UserStatus;
}

export const userStore = {
  async countAll(tenantId = 'default'): Promise<number> {
    const db = await getAuthDb();
    const row = await db.get('SELECT COUNT(*) as c FROM auth_users WHERE tenant_id = ?', [tenantId]);
    return Number(row?.['c'] ?? 0);
  },

  async create(input: CreateUserInput): Promise<AuthUser> {
    const db = await getAuthDb();
    const id = db.newId();
    const tenantId = input.tenantId ?? 'default';
    const passwordHash = await hashPassword(input.password);
    const now = db.nowIso();
    await db.run(
      `INSERT INTO auth_users
        (id, tenant_id, username, email, display_name, password_hash, status,
         must_change_password, failed_login_count, password_changed_at,
         created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
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
      ],
    );
    const row = await db.get('SELECT * FROM auth_users WHERE id = ?', [id]);
    return rowToUser(row as AuthDbRow);
  },

  async findById(id: string, tenantId = 'default'): Promise<AuthUser | null> {
    const db = await getAuthDb();
    const row = await db.get('SELECT * FROM auth_users WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    return row ? rowToUser(row) : null;
  },

  async findByUsername(username: string, tenantId = 'default'): Promise<AuthUser | null> {
    const db = await getAuthDb();
    const row = await db.get('SELECT * FROM auth_users WHERE username = ? AND tenant_id = ?', [username, tenantId]);
    return row ? rowToUser(row) : null;
  },

  async findByUsernameOrEmail(identifier: string, tenantId = 'default'): Promise<AuthUser | null> {
    const db = await getAuthDb();
    const row = await db.get(
      'SELECT * FROM auth_users WHERE (username = ? OR email = ?) AND tenant_id = ?',
      [identifier, identifier, tenantId],
    );
    return row ? rowToUser(row) : null;
  },

  /** Internal — includes password_hash, only for the login/verify path. */
  async findByUsernameOrEmailWithHash(
    identifier: string,
    tenantId = 'default',
  ): Promise<(AuthUser & { passwordHash: string }) | null> {
    const db = await getAuthDb();
    const row = await db.get(
      'SELECT * FROM auth_users WHERE (username = ? OR email = ?) AND tenant_id = ?',
      [identifier, identifier, tenantId],
    );
    if (!row) return null;
    return { ...rowToUser(row), passwordHash: String(row['password_hash']) };
  },

  async list(tenantId = 'default'): Promise<AuthUser[]> {
    const db = await getAuthDb();
    const rows = await db.all('SELECT * FROM auth_users WHERE tenant_id = ? ORDER BY created_at DESC', [tenantId]);
    return rows.map(rowToUser);
  },

  async update(id: string, input: UpdateUserInput, tenantId = 'default'): Promise<AuthUser | null> {
    const db = await getAuthDb();
    const existing = await this.findById(id, tenantId);
    if (!existing) return null;
    await db.run(
      `UPDATE auth_users SET email = ?, display_name = ?, status = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      [
        input.email ?? existing.email,
        input.displayName ?? existing.displayName,
        input.status ?? existing.status,
        db.nowIso(),
        id,
        tenantId,
      ],
    );
    return this.findById(id, tenantId);
  },

  async delete(id: string, tenantId = 'default'): Promise<boolean> {
    const db = await getAuthDb();
    const result = await db.run('DELETE FROM auth_users WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    return result.changes > 0;
  },

  async setPassword(id: string, plaintext: string, mustChangePassword = false): Promise<void> {
    const db = await getAuthDb();
    const hash = await hashPassword(plaintext);
    await db.run(
      `UPDATE auth_users SET password_hash = ?, password_changed_at = ?, must_change_password = ?,
        failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      [hash, db.nowIso(), mustChangePassword ? 1 : 0, db.nowIso(), id],
    );
  },

  async setMustChangePassword(id: string, mustChange: boolean): Promise<void> {
    const db = await getAuthDb();
    await db.run('UPDATE auth_users SET must_change_password = ?, updated_at = ? WHERE id = ?', [
      mustChange ? 1 : 0,
      db.nowIso(),
      id,
    ]);
  },

  async setStatus(id: string, status: UserStatus): Promise<void> {
    const db = await getAuthDb();
    await db.run('UPDATE auth_users SET status = ?, updated_at = ? WHERE id = ?', [status, db.nowIso(), id]);
  },

  async recordFailedLogin(id: string, lockoutThreshold: number, lockoutMinutes: number): Promise<{ locked: boolean }> {
    const db = await getAuthDb();
    const row = await db.get('SELECT failed_login_count FROM auth_users WHERE id = ?', [id]);
    const nextCount = Number(row?.['failed_login_count'] ?? 0) + 1;
    const locked = nextCount >= lockoutThreshold;
    if (locked) {
      const lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000).toISOString();
      await db.run(
        `UPDATE auth_users SET failed_login_count = ?, status = 'locked', locked_until = ?, updated_at = ? WHERE id = ?`,
        [nextCount, lockedUntil, db.nowIso(), id],
      );
    } else {
      await db.run(`UPDATE auth_users SET failed_login_count = ?, updated_at = ? WHERE id = ?`, [
        nextCount,
        db.nowIso(),
        id,
      ]);
    }
    return { locked };
  },

  async recordSuccessfulLogin(id: string, ip: string | null): Promise<void> {
    const db = await getAuthDb();
    await db.run(
      `UPDATE auth_users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, last_login_ip = ?, updated_at = ?
       WHERE id = ?`,
      [db.nowIso(), ip, db.nowIso(), id],
    );
  },

  async unlock(id: string): Promise<void> {
    const db = await getAuthDb();
    await db.run(
      `UPDATE auth_users SET status = 'active', failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`,
      [db.nowIso(), id],
    );
  },

  /** True if `lockedUntil` has passed — caller should auto-unlock for a smooth UX. */
  isLockExpired(user: AuthUser): boolean {
    if (user.status !== 'locked' || !user.lockedUntil) return false;
    return new Date(user.lockedUntil).getTime() <= Date.now();
  },
};
