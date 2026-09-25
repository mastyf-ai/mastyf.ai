import { getAuthDb } from './db/auth-db.js';
async function rowToGroup(row) {
    const db = await getAuthDb();
    const roles = await db.all('SELECT role_id FROM auth_group_roles WHERE group_id = ?', [row['id']]);
    const memberCount = await db.get('SELECT COUNT(*) as c FROM auth_user_groups WHERE group_id = ?', [row['id']]);
    return {
        id: String(row['id']),
        tenantId: String(row['tenant_id']),
        name: String(row['name']),
        description: String(row['description'] ?? ''),
        roleIds: roles.map((r) => String(r['role_id'])),
        memberCount: Number(memberCount?.['c'] ?? 0),
        createdAt: String(row['created_at']),
        updatedAt: String(row['updated_at']),
    };
}
export const groupStore = {
    async list(tenantId = 'default') {
        const db = await getAuthDb();
        const rows = await db.all('SELECT * FROM auth_groups WHERE tenant_id = ? ORDER BY name', [tenantId]);
        return Promise.all(rows.map(rowToGroup));
    },
    async findById(id, tenantId = 'default') {
        const db = await getAuthDb();
        const row = await db.get('SELECT * FROM auth_groups WHERE id = ? AND tenant_id = ?', [id, tenantId]);
        return row ? rowToGroup(row) : null;
    },
    async create(input) {
        const db = await getAuthDb();
        const id = db.newId();
        const tenantId = input.tenantId ?? 'default';
        const now = db.nowIso();
        await db.run('INSERT INTO auth_groups (id, tenant_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, tenantId, input.name, input.description ?? '', now, now]);
        for (const roleId of input.roleIds ?? []) {
            await db.run('INSERT INTO auth_group_roles (group_id, role_id) VALUES (?, ?)', [id, roleId]);
        }
        return (await this.findById(id, tenantId));
    },
    async update(id, input, tenantId = 'default') {
        const db = await getAuthDb();
        const existing = await this.findById(id, tenantId);
        if (!existing)
            return null;
        await db.run('UPDATE auth_groups SET name = ?, description = ?, updated_at = ? WHERE id = ?', [
            input.name ?? existing.name,
            input.description ?? existing.description,
            db.nowIso(),
            id,
        ]);
        if (input.roleIds) {
            await db.run('DELETE FROM auth_group_roles WHERE group_id = ?', [id]);
            for (const roleId of input.roleIds) {
                await db.run('INSERT INTO auth_group_roles (group_id, role_id) VALUES (?, ?)', [id, roleId]);
            }
        }
        return this.findById(id, tenantId);
    },
    async delete(id, tenantId = 'default') {
        const db = await getAuthDb();
        const result = await db.run('DELETE FROM auth_groups WHERE id = ? AND tenant_id = ?', [id, tenantId]);
        return result.changes > 0;
    },
    async addMember(groupId, userId, addedBy) {
        const db = await getAuthDb();
        await db.run(db.dialect === 'postgres'
            ? 'INSERT INTO auth_user_groups (user_id, group_id, added_at, added_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
            : 'INSERT OR IGNORE INTO auth_user_groups (user_id, group_id, added_at, added_by) VALUES (?, ?, ?, ?)', [userId, groupId, db.nowIso(), addedBy ?? null]);
    },
    async removeMember(groupId, userId) {
        const db = await getAuthDb();
        await db.run('DELETE FROM auth_user_groups WHERE group_id = ? AND user_id = ?', [groupId, userId]);
    },
    async setMembers(groupId, userIds, addedBy) {
        const db = await getAuthDb();
        await db.run('DELETE FROM auth_user_groups WHERE group_id = ?', [groupId]);
        for (const userId of userIds) {
            await this.addMember(groupId, userId, addedBy);
        }
    },
    async membersOf(groupId) {
        const db = await getAuthDb();
        const rows = await db.all('SELECT user_id FROM auth_user_groups WHERE group_id = ?', [groupId]);
        return rows.map((r) => String(r['user_id']));
    },
    /** Replace all of a user's group memberships with the given group id list. */
    async setGroupsForUser(userId, groupIds, addedBy) {
        const db = await getAuthDb();
        await db.run('DELETE FROM auth_user_groups WHERE user_id = ?', [userId]);
        for (const groupId of groupIds) {
            await this.addMember(groupId, userId, addedBy);
        }
    },
    async groupsForUser(userId) {
        const db = await getAuthDb();
        const rows = await db.all(`SELECT g.* FROM auth_groups g
       INNER JOIN auth_user_groups ug ON ug.group_id = g.id
       WHERE ug.user_id = ?`, [userId]);
        return Promise.all(rows.map(rowToGroup));
    },
    async rolesForUserViaGroups(userId) {
        const db = await getAuthDb();
        const rows = await db.all(`SELECT DISTINCT gr.role_id FROM auth_group_roles gr
       INNER JOIN auth_user_groups ug ON ug.group_id = gr.group_id
       WHERE ug.user_id = ?`, [userId]);
        return rows.map((r) => String(r['role_id']));
    },
};
//# sourceMappingURL=group-store.js.map