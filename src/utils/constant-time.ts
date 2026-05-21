import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string equality for security-sensitive comparisons (cache keys, tokens).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Compare a candidate to an expected value without early exit on first mismatch (length still checked in CT).
 */
export function constantTimeEqualExpected(candidate: string, expected: string): boolean {
  const maxLen = Math.max(candidate.length, expected.length, 1);
  const padA = candidate.padEnd(maxLen, '\0');
  const padB = expected.padEnd(maxLen, '\0');
  let diff = candidate.length ^ expected.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= padA.charCodeAt(i) ^ padB.charCodeAt(i);
  }
  return diff === 0;
}

/** SHA-256 hex digest (not for secrets — fingerprinting only). */
export function stableFingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
