import type { AuthSettings, LockoutPolicy, PasswordPolicy } from './rbac-types.js';
/** Allows partial updates to the nested policy objects, not just top-level fields. */
export type AuthSettingsPatch = Partial<Omit<AuthSettings, 'passwordPolicy' | 'lockoutPolicy'>> & {
    passwordPolicy?: Partial<PasswordPolicy>;
    lockoutPolicy?: Partial<LockoutPolicy>;
};
export declare const DEFAULT_AUTH_SETTINGS: AuthSettings;
export declare const authSettingsStore: {
    get(tenantId?: string): Promise<AuthSettings>;
    update(tenantId: string, partial: AuthSettingsPatch, updatedBy?: string | null): Promise<AuthSettings>;
    invalidateCache(): void;
};
//# sourceMappingURL=auth-settings-store.d.ts.map