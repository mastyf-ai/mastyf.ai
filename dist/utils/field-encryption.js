import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX_V1 = 'genc1:';
const PREFIX_V2 = 'genc2:';
const PREFIX_V3 = 'genc3:';
const SALT_LEN = 16;
function deploymentSalt() {
    const fromEnv = process.env['MASTYF_AI_DB_ENCRYPTION_SALT']?.trim();
    if (fromEnv) {
        return Buffer.from(createHash('sha256').update(fromEnv).digest().subarray(0, SALT_LEN));
    }
    const keyRaw = process.env['MASTYF_AI_DB_ENCRYPTION_KEY']?.trim();
    if (keyRaw) {
        return Buffer.from(createHash('sha256').update(`salt:${keyRaw}`).digest().subarray(0, SALT_LEN));
    }
    return Buffer.from(createHash('sha256').update('mastyf-ai-field-v1').digest().subarray(0, SALT_LEN));
}
function deriveKey(raw, salt) {
    return scryptSync(raw, salt, 32);
}
export function isFieldEncryptionEnabled() {
    return Boolean(process.env['MASTYF_AI_DB_ENCRYPTION_KEY']?.trim());
}
export function isAuditArgsEncryptionEnabled() {
    return isFieldEncryptionEnabled() && process.env['MASTYF_AI_DB_ENCRYPT_AUDIT_ARGS'] === 'true';
}
/** Encrypt redacted argument snippets when MASTYF_AI_DB_ENCRYPT_AUDIT_ARGS=true. */
export function encryptAuditArgsField(plaintext) {
    if (plaintext == null || plaintext === '')
        return plaintext ?? null;
    if (!isAuditArgsEncryptionEnabled())
        return plaintext;
    return encryptField(plaintext);
}
export function decryptAuditArgsField(stored) {
    if (stored == null || stored === '')
        return stored ?? null;
    if (!isAuditArgsEncryptionEnabled())
        return stored;
    return decryptField(stored);
}
export function getFieldEncryptionKey() {
    const k = process.env['MASTYF_AI_DB_ENCRYPTION_KEY']?.trim();
    return k || undefined;
}
function activeKeyVersion() {
    return (process.env['MASTYF_AI_DB_ENCRYPTION_KEY_VERSION'] || 'v1').trim();
}
function keyForVersion(version) {
    if (version === activeKeyVersion())
        return getFieldEncryptionKey();
    const env = process.env[`MASTYF_AI_DB_ENCRYPTION_KEY_${version.toUpperCase()}`]?.trim();
    return env || undefined;
}
export function getFieldEncryptionStatus() {
    return {
        enabled: isFieldEncryptionEnabled(),
        activeVersion: activeKeyVersion(),
        rotationEnabled: process.env['MASTYF_AI_DB_ENCRYPTION_ROTATION_ENABLED'] === 'true',
    };
}
/** Encrypt a sensitive column value (returns plaintext when key unset). */
export function encryptField(plaintext) {
    if (plaintext == null || plaintext === '')
        return plaintext ?? null;
    const keyRaw = getFieldEncryptionKey();
    if (!keyRaw)
        return plaintext;
    const salt = deploymentSalt();
    const key = deriveKey(keyRaw, salt);
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([salt, iv, tag, enc]).toString('base64');
    return `${PREFIX_V3}${activeKeyVersion()}:${payload}`;
}
/** Decrypt a value written by encryptField (pass-through when not encrypted). */
export function decryptField(stored) {
    if (stored == null || stored === '')
        return stored ?? null;
    const keyRaw = getFieldEncryptionKey();
    if (!keyRaw)
        return stored;
    if (stored.startsWith(PREFIX_V3)) {
        const rest = stored.slice(PREFIX_V3.length);
        const [version, b64] = rest.split(':', 2);
        const keyVersion = version || activeKeyVersion();
        const keyRawVersion = keyForVersion(keyVersion);
        if (!keyRawVersion || !b64)
            return stored;
        const buf = Buffer.from(b64, 'base64');
        const salt = buf.subarray(0, SALT_LEN);
        const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
        const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
        const data = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
        const key = deriveKey(keyRawVersion, salt);
        const decipher = createDecipheriv(ALGO, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
    if (stored.startsWith(PREFIX_V2)) {
        const buf = Buffer.from(stored.slice(PREFIX_V2.length), 'base64');
        const salt = buf.subarray(0, SALT_LEN);
        const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
        const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
        const data = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
        const key = deriveKey(keyRaw, salt);
        const decipher = createDecipheriv(ALGO, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
    if (stored.startsWith(PREFIX_V1)) {
        const key = scryptSync(keyRaw, 'mastyf-ai-field-v1', 32);
        const buf = Buffer.from(stored.slice(PREFIX_V1.length), 'base64');
        const iv = buf.subarray(0, IV_LEN);
        const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
        const data = buf.subarray(IV_LEN + TAG_LEN);
        const decipher = createDecipheriv(ALGO, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    }
    return stored;
}
//# sourceMappingURL=field-encryption.js.map