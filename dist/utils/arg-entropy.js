/**
 * High-entropy / encoded-payload detection for proxy-time DLP (base64 exfil, long secrets in args).
 */
import { isFpWhitelisted } from '../ai/fp-whitelist.js';
function shannonEntropy(s) {
    if (!s.length)
        return 0;
    const freq = new Map();
    for (const ch of s)
        freq.set(ch, (freq.get(ch) ?? 0) + 1);
    let entropy = 0;
    for (const count of freq.values()) {
        const p = count / s.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}
const MIN_BLOB_LEN = parseInt(process.env.MASTYF_AI_ENTROPY_MIN_LENGTH || '48', 10);
const ENTROPY_THRESHOLD = parseFloat(process.env.MASTYF_AI_ENTROPY_THRESHOLD || '4.2');
export function scanArgumentEntropy(text) {
    const findings = [];
    // Long base64-like runs (DNS exfil bodies, encoded curl payloads)
    for (const match of text.matchAll(/[A-Za-z0-9+/]{48,}={0,2}/g)) {
        const blob = match[0];
        const entropy = shannonEntropy(blob);
        if (entropy >= ENTROPY_THRESHOLD) {
            const kind = 'base64-blob';
            if (isFpWhitelisted('arg-entropy', kind))
                continue;
            findings.push({
                kind,
                preview: blob.slice(0, 24) + '…',
                entropy,
            });
        }
    }
    // DNS exfil: long dotted labels with embedded base64
    if (/(?:[a-z0-9]{20,}\.){3,}[a-z]{2,}/i.test(text) && text.length > 60) {
        const label = text.match(/[a-z0-9]{24,}/i)?.[0];
        const dnsKind = 'dns-exfil';
        if (label && shannonEntropy(label) >= ENTROPY_THRESHOLD && !isFpWhitelisted('arg-entropy', dnsKind)) {
            findings.push({ kind: dnsKind, preview: text.slice(0, 40) + '…', entropy: shannonEntropy(label) });
        }
    }
    // Standalone high-entropy tokens (not caught by regex secret rules)
    for (const match of text.matchAll(/[A-Za-z0-9_\-+/=]{32,}/g)) {
        const token = match[0];
        if (token.length < MIN_BLOB_LEN)
            continue;
        const entropy = shannonEntropy(token);
        const kind = 'high-entropy';
        if (isFpWhitelisted('arg-entropy', kind))
            continue;
        if (entropy >= ENTROPY_THRESHOLD && !findings.some((f) => f.preview.startsWith(token.slice(0, 12)))) {
            findings.push({ kind, preview: token.slice(0, 20) + '…', entropy });
        }
    }
    return findings;
}
export function isProxyEntropyCheckEnabled(policyMode) {
    if (process.env.MASTYF_AI_PROXY_ENTROPY === 'false')
        return false;
    if (process.env.MASTYF_AI_PROXY_ENTROPY === 'true')
        return true;
    return policyMode === 'block';
}
//# sourceMappingURL=arg-entropy.js.map