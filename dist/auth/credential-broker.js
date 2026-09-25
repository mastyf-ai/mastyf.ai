import crypto from 'node:crypto';
import { getPersistenceStore } from '../utils/persistence-store.js';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
function getEncryptionKey() {
    const keyEnv = process.env.MASTYF_AI_CREDENTIAL_ENCRYPTION_KEY
        || process.env.MASTYF_AI_DB_ENCRYPTION_KEY;
    if (!keyEnv) {
        const fallback = crypto.createHash('sha256')
            .update(process.env.DASHBOARD_JWT_SECRET || 'mastyf-ai-dev-key')
            .digest();
        return fallback;
    }
    const key = Buffer.from(keyEnv, 'hex');
    if (key.length < KEY_LENGTH) {
        return crypto.createHash('sha256').update(key).digest();
    }
    return key.subarray(0, KEY_LENGTH);
}
function encrypt(value) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return {
        encrypted,
        iv: iv.toString('hex'),
        authTag,
    };
}
function decrypt(encrypted, iv, authTag) {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
function serializeCredential(cred) {
    return JSON.stringify({
        ...cred,
        encryptedToken: cred.encryptedToken,
        encryptedRefreshToken: cred.encryptedRefreshToken || null,
    });
}
export class CredentialBroker {
    credentialCache = new Map();
    async storeCredential(params) {
        const id = `cred_${crypto.randomBytes(16).toString('hex')}`;
        const encryptedToken = encrypt(params.token);
        const encryptedRefreshToken = params.refreshToken ? encrypt(params.refreshToken) : undefined;
        try {
            const store = getPersistenceStore();
            store.saveCredential({
                id, tenant_id: params.tenantId, user_id: params.userId,
                provider_name: params.providerName, provider_id: params.providerId,
                credential_type: params.credentialType,
                encrypted_token: JSON.stringify(encryptedToken),
                encrypted_refresh_token: encryptedRefreshToken ? JSON.stringify(encryptedRefreshToken) : null,
                scopes: JSON.stringify(params.scopes),
                expires_at: params.expiresAt ? String(params.expiresAt) : null,
                created_at: new Date().toISOString(),
                metadata: JSON.stringify(params.metadata || {}),
            });
        }
        catch { /* non-fatal — cache still works */ }
        const cacheKey = `${params.tenantId}:${params.providerId}:${params.credentialType}`;
        this.credentialCache.set(cacheKey, { token: params.token, expiresAt: params.expiresAt ?? null });
        return id;
    }
    async getCredential(tenantId, providerId, credentialType) {
        const cacheKey = `${tenantId}:${providerId}:${credentialType}`;
        const cached = this.credentialCache.get(cacheKey);
        if (cached) {
            if (cached.expiresAt && Date.now() > cached.expiresAt) {
                this.credentialCache.delete(cacheKey);
            }
            else {
                return { token: cached.token, tokenType: 'Bearer', scopes: [] };
            }
        }
        try {
            const store = getPersistenceStore();
            const row = store.getCredentials(tenantId, providerId, credentialType);
            if (!row)
                return null;
            if (row.expires_at && Date.now() > parseInt(row.expires_at, 10))
                return null;
            const encData = JSON.parse(row.encrypted_token);
            const token = decrypt(encData.encrypted, encData.iv, encData.authTag);
            this.credentialCache.set(cacheKey, { token, expiresAt: row.expires_at ? parseInt(row.expires_at, 10) : null });
            return { token, tokenType: 'Bearer', scopes: JSON.parse(row.scopes || '[]'), expiresAt: row.expires_at ? parseInt(row.expires_at, 10) : undefined };
        }
        catch {
            return null;
        }
    }
    async injectCredentialIntoHeaders(tenantId, providerName, credentialType, headers) {
        const credential = await this.getCredential(tenantId, providerName, credentialType);
        if (!credential)
            return headers;
        const result = { ...headers };
        result['Authorization'] = `Bearer ${credential.token}`;
        return result;
    }
    async stripCredentialsFromResponse(responseBody) {
        const patterns = [
            /Bearer [A-Za-z0-9\-._~+/]+=*/g,
            /"access_token"\s*:\s*"[^"]+"/g,
            /"refresh_token"\s*:\s*"[^"]+"/g,
            /"token"\s*:\s*"[A-Za-z0-9\-._~+/]+=*"/g,
            /"api_key"\s*:\s*"[^"]+"/g,
        ];
        let cleaned = responseBody;
        for (const pattern of patterns) {
            cleaned = cleaned.replace(pattern, '"***REDACTED***"');
        }
        return cleaned;
    }
    async revokeCredential(credentialId) {
        for (const [key] of this.credentialCache) {
            if (key.includes(credentialId))
                this.credentialCache.delete(key);
        }
        try {
            getPersistenceStore().deleteCredentialsForUser(credentialId);
        }
        catch { /* best-effort */ }
        return true;
    }
    async listCredentialsForUser(tenantId, userId) {
        return [];
    }
}
export const credentialBroker = new CredentialBroker();
//# sourceMappingURL=credential-broker.js.map