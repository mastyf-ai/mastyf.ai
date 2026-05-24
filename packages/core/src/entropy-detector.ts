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

// ── Configuration ──────────────────────────────────────────────────
const ENTROPY_THRESHOLD_BPC = 4.5;     // bits per character
const MIN_SECRET_LENGTH = 16;           // minimum string length to consider
const MAX_SECRET_LENGTH = 2048;         // skip massive strings
const SAMPLE_SIZE = 128;               // only analyze first N chars

// Known low-entropy patterns that match length but aren't secrets
const EXCLUSION_PATTERNS: RegExp[] = [
  /^[0-9a-f]{32,}$/i,                   // MD5/SHA hex hashes
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,  // UUID
  /^[A-Za-z0-9+/]{20,}={0,2}$/,         // base64 (already handled by regex)
  /^[0-9]{16,}$/,                        // credit card / numeric only
  /^(?:true|false|null|undefined)$/i,    // JSON primitives
  /^\d{4}-\d{2}-\d{2}/,                  // ISO dates
  /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/,   // IP addresses
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,  // standard base64
];

/**
 * Calculate Shannon entropy of a string in bits per character.
 * E = -Σ(p_i × log₂(p_i)) where p_i is the probability of character i.
 */
export function shannonEntropyBpc(input: string): number {
  if (!input || input.length === 0) return 0;

  const len = input.length;
  const frequencies = new Map<string, number>();

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
function isExcluded(value: string): boolean {
  for (const pattern of EXCLUSION_PATTERNS) {
    if (pattern.test(value)) return true;
  }
  return false;
}

/** Detect high-entropy secrets in a single string value. */
export function detectEntropySecret(
  value: string,
  keyPath: string,
): { detected: boolean; entropyBpc: number; evidence: string } {
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
export function runEntropyScan(
  flat: { keyPath: string; value: string }[],
): Issue[] {
  const issues: Issue[] = [];

  for (const item of flat) {
    if (typeof item.value !== 'string') continue;

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