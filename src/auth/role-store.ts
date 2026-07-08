import { getAuthDb, type AuthDbRow } from './db/auth-db.js';
import { AUTH_PERMISSIONS, SYSTEM_ROLES } from './db/auth-schema.sqlite.js';
import type { AuthPermissionDef, AuthRole, DashboardTier } from './rbac-types.js';

async function rowToRole(row: AuthDbRow): Promise<AuthRole> {
  const db = await getAuthDb();
  const perms = await db.all('SELECT permission_key FROM auth_role_permissions WHERE role_id = ?', [row['id']]);
  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    name: String(row['name']),
    description: String(row['description'] ?? ''),
    isSystem: !!row['is_system'],
    dashboardTier: row['dashboard_tier'] as DashboardTier,
    permissions: perms.map((p) => String(p['permission_key'])),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };
}

export const permissionCatalog = {
  async list(): Promise<AuthPermissionDef[]> {
    const db = await getAuthDb();
    const rows = await db.all('SELECT * FROM auth_permissions ORDER BY category, key');
    if (rows.length > 0) {
      return rows.map((r) => ({
        key: String(r['key']),
        category: String(r['category']),
        description: String(r['description']),
      }));
    }
    return AUTH_PERMISSIONS;
  },

  /** Validate a list of permission keys against the known catalog. */
  async filterValid(keys: string[]): Promise<string[]> {
    const all = new Set((await this.list()).map((p) => p.key));
    return keys.filter((k) => all.has(k));
  },
};

export const roleStore = {
  /** Seed the five system roles + permission catalog if the tables are empty (SQLite has no SQL-file seed). */
  async ensureSeeded(tenantId = 'default'): Promise<void> {
    const db = await getAuthDb();
    if (db.dialect !== 'sqlite') return; // Postgres is seeded by migration 020-auth-rbac.sql

    const permCount = await db.get('SELECT COUNT(*) as c FROM auth_permissions');
    if (Number(permCount?.['c'] ?? 0) === 0) {
      for (const p of AUTH_PERMISSIONS) {
        await db.run('INSERT OR IGNORE INTO auth_permissions (key, category, description) VALUES (?, ?, ?)', [
          p.key,
          p.category,
          p.description,
        ]);
      }
    }

    const roleCount = await db.get('SELECT COUNT(*) as c FROM auth_roles WHERE tenant_id = ?', [tenantId]);
    if (Number(roleCount?.['c'] ?? 0) === 0) {
      for (const r of SYSTEM_ROLES) {
        const id = db.newId();
        const now = db.nowIso();
        await db.run(
          `INSERT INTO auth_roles (id, tenant_id, name, description, is_system, dashboard_tier, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
          [id, tenantId, r.name, r.description, r.dashboardTier, now, now],
        );
        for (const permKey of r.permissions) {
          await db.run('INSERT OR IGNORE INTO auth_role_permissions (role_id, permission_key) VALUES (?, ?)', [
            id,
            permKey,
          ]);
        }
      }
    }
  },

  async list(tenantId = 'default'): Promise<AuthRole[]> {
    const db = await getAuthDb();
    const rows = await db.all('SELECT * FROM auth_roles WHERE tenant_id = ? ORDER BY is_system DESC, name', [
      tenantId,
    ]);
    return Promise.all(rows.map(rowToRole));
  },

  async findById(id: string, tenantId = 'default'): Promise<AuthRole | null> {
    const db = await getAuthDb();
    const row = await db.get('SELECT * FROM auth_roles WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    return row ? rowToRole(row) : null;
  },

  async findByDashboardTier(tier: DashboardTier, tenantId = 'default'): Promise<AuthRole | null> {
    const db = await getAuthDb();
    const row = await db.get(
      'SELECT * FROM auth_roles WHERE dashboard_tier = ? AND tenant_id = ? AND is_system = ' +
        (db.dialect === 'postgres' ? 'TRUE' : '1') +
        ' LIMIT 1',
      [tier, tenantId],
    );
    return row ? rowToRole(row) : null;
  },

  async create(input: {
    tenantId?: string;
    name: string;
    description?: string;
    dashboardTier: DashboardTier;
    permissions: string[];
  }): Promise<AuthRole> {
    const db = await getAuthDb();
    const id = db.newId();
    const tenantId = input.tenantId ?? 'default';
    const now = db.nowIso();
    await db.run(
      `INSERT INTO auth_roles (id, tenant_id, name, description, is_system, dashboard_tier, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      [id, tenantId, input.name, input.description ?? '', input.dashboardTier, now, now],
    );
    const validPerms = await permissionCatalog.filterValid(input.permissions);
    for (const permKey of validPerms) {
      await db.run('INSERT INTO auth_role_permissions (role_id, permission_key) VALUES (?, ?)', [id, permKey]);
    }
    return (await this.findById(id, tenantId)) as AuthRole;
  },

  async update(
    id: string,
    input: { name?: string; description?: string; dashboardTier?: DashboardTier; permissions?: string[] },
    tenantId = 'default',
  ): Promise<AuthRole | null> {
    const db = await getAuthDb();
    const existing = await this.findById(id, tenantId);
    if (!existing) return null;
    if (existing.isSystem && (input.name || input.dashboardTier)) {
      throw Object.assign(new Error('System roles cannot be renamed or retiered'), { statusCode: 400 });
    }
    await db.run('UPDATE auth_roles SET name = ?, description = ?, dashboard_tier = ?, updated_at = ? WHERE id = ?', [
      input.name ?? existing.name,
      input.description ?? existing.description,
      input.dashboardTier ?? existing.dashboardTier,
      db.nowIso(),
      id,
    ]);
    if (input.permissions) {
      await db.run('DELETE FROM auth_role_permissions WHERE role_id = ?', [id]);
      const validPerms = await permissionCatalog.filterValid(input.permissions);
      for (const permKey of validPerms) {
        await db.run('INSERT INTO auth_role_permissions (role_id, permission_key) VALUES (?, ?)', [id, permKey]);
      }
    }
    return this.findById(id, tenantId);
  },

  async delete(id: string, tenantId = 'default'): Promise<boolean> {
    const db = await getAuthDb();
    const existing = await this.findById(id, tenantId);
    if (!existing) return false;
    if (existing.isSystem) {
      throw Object.assign(new Error('System roles cannot be deleted'), { statusCode: 400 });
    }
    const result = await db.run('DELETE FROM auth_roles WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    return result.changes > 0;
  },

  async assignToUser(userId: string, roleId: string, assignedBy?: string | null): Promise<void> {
    const db = await getAuthDb();
    await db.run(
      db.dialect === 'postgres'
        ? 'INSERT INTO auth_user_roles (user_id, role_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
        : 'INSERT OR IGNORE INTO auth_user_roles (user_id, role_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)',
      [userId, roleId, db.nowIso(), assignedBy ?? null],
    );
  },

  async removeFromUser(userId: string, roleId: string): Promise<void> {
    const db = await getAuthDb();
    await db.run('DELETE FROM auth_user_roles WHERE user_id = ? AND role_id = ?', [userId, roleId]);
  },

  async setUserRoles(userId: string, roleIds: string[], assignedBy?: string | null): Promise<void> {
    const db = await getAuthDb();
    await db.run('DELETE FROM auth_user_roles WHERE user_id = ?', [userId]);
    for (const roleId of roleIds) {
      await this.assignToUser(userId, roleId, assignedBy);
    }
  },

  async rolesForUser(userId: string): Promise<AuthRole[]> {
    const db = await getAuthDb();
    const rows = await db.all(
      `SELECT r.* FROM auth_roles r
       INNER JOIN auth_user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?`,
      [userId],
    );
    return Promise.all(rows.map(rowToRole));
  },
};
