// ── Configuration ──────────────────────────────────────────────────
const ENTROPY_THRESHOLD_BPC = 4.5; // bits per character
const MIN_SECRET_LENGTH = 16; // minimum string length to consider
const MAX_SECRET_LENGTH = 2048; // skip massive strings
const SAMPLE_SIZE = 128; // only analyze first N chars
// Known low-entropy patterns that match length but aren't secrets
const EXCLUSION_PATTERNS = [
    /^[0-9a-f]{32,}$/i, // MD5/SHA hex hashes
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
    /^[A-Za-z0-9+/]{20,}={0,2}$/, // base64 (already handled by regex)
    /^[0-9]{16,}$/, // credit card / numeric only
    /^(?:true|false|null|undefined)$/i, // JSON primitives
    /^\d{4}-\d{2}-\d{2}/, // ISO dates
    /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/, // IP addresses
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, // standard base64
];
/**
 * Calculate Shannon entropy of a string in bits per character.
 * E = -Σ(p_i × log₂(p_i)) where p_i is the probability of character i.
 */
export function shannonEntropyBpc(input) {
    if (!input || input.length === 0)
        return 0;
    const len = input.length;
    const frequencies = new Map();
    for (const char of input) {
        frequencies.set(char, (frequencies.get(char) || 0) + 1);
    }
    let entropy = 0;
    for (const count of frequencies.values()) {
        const probability = count / len;
        entropy -= probability * Math.log2(probability);
    }
    return entropy;
}
/** Check if a value is excluded from entropy scanning (known low-entropy patterns). */
function isExcluded(value) {
    for (const pattern of EXCLUSION_PATTERNS) {
        if (pattern.test(value))
            return true;
    }
    return false;
}
/** Detect high-entropy secrets in a single string value. */
export function detectEntropySecret(value, keyPath) {
    const trimmed = value.trim();
    if (trimmed.length < MIN_SECRET_LENGTH) {
        return { detected: false, entropyBpc: 0, evidence: '' };
    }
    if (trimmed.length > MAX_SECRET_LENGTH) {
        return { detected: false, entropyBpc: 0, evidence: '' };
    }
    if (isExcluded(trimmed)) {
        return { detected: false, entropyBpc: 0, evidence: '' };
    }
    const sample = trimmed.slice(0, SAMPLE_SIZE);
    const entropy = shannonEntropyBpc(sample);
    if (entropy >= ENTROPY_THRESHOLD_BPC) {
        return {
            detected: true,
            entropyBpc: Math.round(entropy * 100) / 100,
            evidence: sample.slice(0, 40) + (sample.length > 40 ? '...' : ''),
        };
    }
    return { detected: false, entropyBpc: Math.round(entropy * 100) / 100, evidence: '' };
}
/**
 * Scan a flat list of (keyPath, value) pairs for high-entropy strings.
 * Returns Issue objects for any detected probable secrets.
 */
export function runEntropyScan(flat) {
    const issues = [];
    for (const item of flat) {
        if (typeof item.value !== 'string')
            continue;
        const result = detectEntropySecret(item.value, item.keyPath);
        if (result.detected) {
            issues.push({
                id: 'MCPG-A-ENT-001',
                layer: 'regex',
                severity: 'warning',
                category: 'credential-exfil',
                message: `High-entropy probable secret in "${item.keyPath}" (${result.entropyBpc} bits/char)`,
                evidence: result.evidence,
                confidence: Math.min(0.85, 0.5 + (result.entropyBpc - ENTROPY_THRESHOLD_BPC) * 0.2),
            });
        }
    }
    return issues;
}
const OPENAI_KEY_RE = /^sk-[A-Za-z0-9_-]{20,}$/;
const ANTHROPIC_KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,}$/;
const BEARER_JWT_RE = /^Bearer\s+[A-Za-z0-9._-]{20,}$/i;
const MIN_PROVIDER_KEY_ENTROPY = 3.8;
const MIN_PROVIDER_KEY_LENGTH = 40;
function redactCredentialEvidence(value) {
    if (value.length <= 8)
        return '***';
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
/** Flag provider-shaped API keys with insufficient entropy (format-only bypass). */
export function runCredentialFormatScan(flat) {
    const issues = [];
    for (const item of flat) {
        const trimmed = item.value.trim();
        const looksLikeKey = OPENAI_KEY_RE.test(trimmed)
            || ANTHROPIC_KEY_RE.test(trimmed)
            || BEARER_JWT_RE.test(trimmed);
        if (!looksLikeKey)
            continue;
        const entropy = shannonEntropyBpc(trimmed.replace(/^Bearer\s+/i, ''));
        if (trimmed.length < MIN_PROVIDER_KEY_LENGTH || entropy < MIN_PROVIDER_KEY_ENTROPY) {
            issues.push({
                id: 'MCPG-CRED-001',
                layer: 'regex',
                severity: 'warning',
                category: 'weak-credential',
                message: `Probable API key with low entropy in "${item.keyPath}"`,
                evidence: redactCredentialEvidence(trimmed),
                confidence: 0.82,
            });
        }
    }
    return issues;
}
//# sourceMappingURL=entropy-detector.js.map