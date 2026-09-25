import { getAuthDb } from './db/auth-db.js';
import { DEFAULT_PASSWORD_POLICY } from './password.js';
export const DEFAULT_AUTH_SETTINGS = {
    passwordPolicy: DEFAULT_PASSWORD_POLICY,
    lockoutPolicy: {
        maxFailedAttempts: 5,
        lockoutDurationMinutes: 15,
    },
    sessionTimeoutMinutes: 60,
    sessionAbsoluteTimeoutMinutes: 60 * 24 * 7, // 7 days
    requireMfaForAdmins: false,
    allowSelfRegistration: false,
};
let cache = null;
export const authSettingsStore = {
    async get(tenantId = 'default') {
        if (cache && cache.tenantId === tenantId)
            return cache.settings;
        const db = await getAuthDb();
        const row = await db.get('SELECT settings FROM auth_settings WHERE tenant_id = ?', [tenantId]);
        let settings = DEFAULT_AUTH_SETTINGS;
        if (row?.['settings']) {
            try {
                const raw = row['settings'];
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                settings = { ...DEFAULT_AUTH_SETTINGS, ...parsed };
            }
            catch {
                settings = DEFAULT_AUTH_SETTINGS;
            }
        }
        cache = { tenantId, settings };
        return settings;
    },
    async update(tenantId, partial, updatedBy) {
        const db = await getAuthDb();
        const current = await this.get(tenantId);
        const merged = {
            ...current,
            ...partial,
            passwordPolicy: { ...current.passwordPolicy, ...partial.passwordPolicy },
            lockoutPolicy: { ...current.lockoutPolicy, ...partial.lockoutPolicy },
        };
        const json = JSON.stringify(merged);
        const exists = await db.get('SELECT 1 FROM auth_settings WHERE tenant_id = ?', [tenantId]);
        if (exists) {
            await db.run('UPDATE auth_settings SET settings = ?, updated_at = ?, updated_by = ? WHERE tenant_id = ?', [
                json,
                db.nowIso(),
                updatedBy ?? null,
                tenantId,
            ]);
        }
        else {
            await db.run('INSERT INTO auth_settings (tenant_id, settings, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
                tenantId,
                json,
                db.nowIso(),
                updatedBy ?? null,
            ]);
        }
        cache = { tenantId, settings: merged };
        return merged;
    },
    invalidateCache() {
        cache = null;
    },
};
//# sourceMappingURL=auth-settings-store.js.map