import { getAuthDb } from './db/auth-db.js';
import { userStore } from './user-store.js';

export const setupState = {
  /**
   * Setup is considered complete once either:
   *  (a) the auth_setup_state row is marked completed, or
   *  (b) at least one user already exists (defensive — covers upgrades
   *      from an environment where users were provisioned out-of-band).
   * Once true, POST /api/auth/setup permanently 403s.
   */
  async isComplete(tenantId = 'default'): Promise<boolean> {
    const db = await getAuthDb();
    const row = await db.get('SELECT completed FROM auth_setup_state WHERE tenant_id = ?', [tenantId]);
    if (row && !!row['completed']) return true;
    const userCount = await userStore.countAll(tenantId);
    return userCount > 0;
  },

  async markComplete(tenantId = 'default'): Promise<void> {
    const db = await getAuthDb();
    const exists = await db.get('SELECT 1 FROM auth_setup_state WHERE tenant_id = ?', [tenantId]);
    if (exists) {
      await db.run('UPDATE auth_setup_state SET completed = ?, completed_at = ? WHERE tenant_id = ?', [
        db.dialect === 'postgres' ? true : 1,
        db.nowIso(),
        tenantId,
      ]);
    } else {
      await db.run('INSERT INTO auth_setup_state (tenant_id, completed, completed_at) VALUES (?, ?, ?)', [
        tenantId,
        db.dialect === 'postgres' ? true : 1,
        db.nowIso(),
      ]);
    }
  },
};
