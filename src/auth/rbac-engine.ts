import { roleStore } from './role-store.js';
import { groupStore } from './group-store.js';
import { getAuthDb } from './db/auth-db.js';
import type { AuthUserWithAccess, AuthUser, DashboardTier } from './rbac-types.js';

const DASHBOARD_TIER_ORDER: DashboardTier[] = ['viewer', 'analyst', 'operator', 'admin', 'tenant-admin'];

function highestTier(tiers: DashboardTier[]): DashboardTier {
  let best: DashboardTier = 'viewer';
  for (const t of tiers) {
    if (DASHBOARD_TIER_ORDER.indexOf(t) > DASHBOARD_TIER_ORDER.indexOf(best)) best = t;
  }
  return best;
}

/**
 * Compute a user's effective access: union of permissions from roles
 * assigned directly to the user, plus roles inherited from any group the
 * user belongs to. Also derives the coarse DashboardRole tier array the
 * existing frontend (`lib/dashboard-roles.ts`) already knows how to gate
 * on, so legacy panels keep working without modification.
 */
export async function resolveUserAccess(user: AuthUser): Promise<AuthUserWithAccess> {
  const directRoles = await roleStore.rolesForUser(user.id);
  const groups = await groupStore.groupsForUser(user.id);
  const groupRoleIds = await groupStore.rolesForUserViaGroups(user.id);

  const allRoleIds = new Set<string>([...directRoles.map((r) => r.id), ...groupRoleIds]);
  const allRoles = await Promise.all(
    Array.from(allRoleIds).map((id) => roleStore.findById(id, user.tenantId)),
  );
  const resolvedRoles = allRoles.filter((r): r is NonNullable<typeof r> => !!r);

  const permissionSet = new Set<string>();
  for (const role of resolvedRoles) {
    for (const p of role.permissions) permissionSet.add(p);
  }

  const tiers = resolvedRoles.map((r) => r.dashboardTier);
  const dashboardRoles = tiers.length > 0 ? [highestTier(tiers)] : ['viewer' as DashboardTier];

  return {
    ...user,
    roles: resolvedRoles.map((r) => ({ id: r.id, name: r.name, dashboardTier: r.dashboardTier })),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    permissions: Array.from(permissionSet).sort(),
    dashboardRoles,
  };
}

export async function userHasPermission(userId: string, tenantId: string, permission: string): Promise<boolean> {
  const db = await getAuthDb();
  const row = await db.get(
    `SELECT 1 FROM auth_role_permissions rp
     INNER JOIN auth_user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = ? AND rp.permission_key = ?
     LIMIT 1`,
    [userId, permission],
  );
  if (row) return true;

  const viaGroup = await db.get(
    `SELECT 1 FROM auth_role_permissions rp
     INNER JOIN auth_group_roles gr ON gr.role_id = rp.role_id
     INNER JOIN auth_user_groups ug ON ug.group_id = gr.group_id
     WHERE ug.user_id = ? AND rp.permission_key = ?
     LIMIT 1`,
    [userId, permission],
  );
  void tenantId; // reserved for future cross-tenant permission scoping
  return !!viaGroup;
}
