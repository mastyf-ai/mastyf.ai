/**
 * Shannon Entropy-based Secret Detector
 *
 * Detects high-entropy strings (API keys, tokens, secrets) embedded in
 * tool call arguments that regex patterns might miss. Runs alongside
 * the argument scanner's credential patterns for defense-in-depth.
 *
 * Algorithm: Shannon entropy → bits per character. Strings above
 * the threshold (default 4.5 bits/char) are flagged as probable secrets.
 * Includes length floor (min 16 chars) and exclusion list (UUIDs, hashes).
 */
import type { Issue } from './types.js';
/**
 * Calculate Shannon entropy of a string in bits per character.
 * E = -Σ(p_i × log₂(p_i)) where p_i is the probability of character i.
 */
export declare function shannonEntropyBpc(input: string): number;
/** Detect high-entropy secrets in a single string value. */
export declare function detectEntropySecret(value: string, keyPath: string): {
    detected: boolean;
    entropyBpc: number;
    evidence: string;
};
/**
 * Scan a flat list of (keyPath, value) pairs for high-entropy strings.
 * Returns Issue objects for any detected probable secrets.
 */
export declare function runEntropyScan(flat: {
    keyPath: string;
    value: string;
}[]): Issue[];
/** Flag provider-shaped API keys with insufficient entropy (format-only bypass). */
export declare function runCredentialFormatScan(flat: {
    keyPath: string;
    value: string;
}[]): Issue[];
//# sourceMappingURL=entropy-detector.d.ts.map