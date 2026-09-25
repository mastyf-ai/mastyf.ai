import type { AuthUser, UserStatus } from './rbac-types.js';
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
export declare const userStore: {
    countAll(tenantId?: string): Promise<number>;
    create(input: CreateUserInput): Promise<AuthUser>;
    findById(id: string, tenantId?: string): Promise<AuthUser | null>;
    findByUsername(username: string, tenantId?: string): Promise<AuthUser | null>;
    findByUsernameOrEmail(identifier: string, tenantId?: string): Promise<AuthUser | null>;
    /** Internal — includes password_hash, only for the login/verify path. */
    findByUsernameOrEmailWithHash(identifier: string, tenantId?: string): Promise<(AuthUser & {
        passwordHash: string;
    }) | null>;
    list(tenantId?: string): Promise<AuthUser[]>;
    update(id: string, input: UpdateUserInput, tenantId?: string): Promise<AuthUser | null>;
    delete(id: string, tenantId?: string): Promise<boolean>;
    setPassword(id: string, plaintext: string, mustChangePassword?: boolean): Promise<void>;
    setMustChangePassword(id: string, mustChange: boolean): Promise<void>;
    setStatus(id: string, status: UserStatus): Promise<void>;
    recordFailedLogin(id: string, lockoutThreshold: number, lockoutMinutes: number): Promise<{
        locked: boolean;
    }>;
    recordSuccessfulLogin(id: string, ip: string | null): Promise<void>;
    unlock(id: string): Promise<void>;
    /** True if `lockedUntil` has passed — caller should auto-unlock for a smooth UX. */
    isLockExpired(user: AuthUser): boolean;
};
//# sourceMappingURL=user-store.d.ts.map