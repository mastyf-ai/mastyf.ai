/**
 * Ephemeral in-request credential vault — scrubs provider-shaped secrets from logs (zero persistence).
 */
import { AsyncLocalStorage } from 'async_hooks';
const store = new AsyncLocalStorage();
const PROVIDER_SECRET = /\b(sk-[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|ghp_[a-zA-Z0-9]{36,}|AKIA[0-9A-Z]{16})\b/g;
export function runWithEphemeralCredentialVault(fn) {
    return store.run(new Set(), fn);
}
export function captureEphemeralSecrets(text) {
    const secrets = store.getStore();
    if (!secrets || !text)
        return;
    for (const match of text.matchAll(PROVIDER_SECRET)) {
        if (match[0])
            secrets.add(match[0]);
    }
}
export function redactEphemeralSecrets(text) {
    const secrets = store.getStore();
    if (!secrets || secrets.size === 0)
        return text;
    let out = text;
    for (const secret of secrets) {
        out = out.split(secret).join('[REDACTED_CREDENTIAL]');
    }
    return out;
}
//# sourceMappingURL=ephemeral-credential-vault.js.map