export declare function isFieldEncryptionEnabled(): boolean;
export declare function isAuditArgsEncryptionEnabled(): boolean;
/** Encrypt redacted argument snippets when MASTYF_AI_DB_ENCRYPT_AUDIT_ARGS=true. */
export declare function encryptAuditArgsField(plaintext: string | null | undefined): string | null;
export declare function decryptAuditArgsField(stored: string | null | undefined): string | null;
export declare function getFieldEncryptionKey(): string | undefined;
export declare function getFieldEncryptionStatus(): {
    enabled: boolean;
    activeVersion: string;
    rotationEnabled: boolean;
};
/** Encrypt a sensitive column value (returns plaintext when key unset). */
export declare function encryptField(plaintext: string | null | undefined): string | null;
/** Decrypt a value written by encryptField (pass-through when not encrypted). */
export declare function decryptField(stored: string | null | undefined): string | null;
//# sourceMappingURL=field-encryption.d.ts.map