import type { PasswordPolicy } from './rbac-types.js';
export declare function hashPassword(plaintext: string): Promise<string>;
export declare function verifyPassword(hash: string, plaintext: string): Promise<boolean>;
export declare const DEFAULT_PASSWORD_POLICY: PasswordPolicy;
export interface PasswordValidationResult {
    valid: boolean;
    errors: string[];
}
export declare function validatePasswordAgainstPolicy(password: string, policy: PasswordPolicy, context?: {
    username?: string;
    email?: string;
}): PasswordValidationResult;
/** Generate a cryptographically strong random password (used for admin-issued resets). */
export declare function generateRandomPassword(length?: number): string;
//# sourceMappingURL=password.d.ts.map