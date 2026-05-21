/**
 * Multi-layer encoding evasion detection — base64, hex, URL chains, and
 * mismatch between raw arguments and deobfuscated content.
 */
import type { CallContext, PolicyDecision } from './policy-types.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { deobfuscateRecursive } from '../utils/payload-normalizer.js';

const BASE64_BLOB_RE = /(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{20,}={0,2})(?:[^A-Za-z0-9+/]|$)/g;
const RAW_HEX_BLOB_RE = /\b([0-9a-fA-F]{16,})\b/g;
const PERCENT_ENCODED_RUN_RE = /(?:%[0-9a-fA-F]{2}){4,}/i;
const SUSPICIOUS_DECODED_RE =
  /\b(?:ignore|disregard|override|bypass|jailbreak|delete|drop|exec|eval|curl|wget|rm\s+-rf|union\s+select|sleep\s*\(|benchmark\s*\(|\/etc\/passwd)\b/i;

export function isEncodingGuardEnabled(): boolean {
  return process.env['GUARDIAN_ENCODING_GUARD'] !== 'false';
}

function tryDecodeBase64(b64: string): string | null {
  if (b64.length < 12 || b64.length % 4 === 1) return null;
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    if (decoded.length < 4 || !/^[\x20-\x7E\u00A0-\uFFFF\s]+$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function tryDecodeRawHex(hex: string): string | null {
  if (hex.length < 16 || hex.length % 2 !== 0) return null;
  try {
    const decoded = Buffer.from(hex, 'hex').toString('utf8');
    if (decoded.length < 4 || !/^[\x20-\x7E]+$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function scanEncodingEvasion(blob: string): { matched: boolean; reason: string } {
  if (!blob.trim()) return { matched: false, reason: '' };

  const deobfuscated = deobfuscateRecursive(blob);
  if (
    deobfuscated.length > 0 &&
    deobfuscated !== blob &&
    SUSPICIOUS_DECODED_RE.test(deobfuscated) &&
    !SUSPICIOUS_DECODED_RE.test(blob)
  ) {
    return { matched: true, reason: 'multi-layer encoding reveals blocked content after decode' };
  }

  if (PERCENT_ENCODED_RUN_RE.test(blob) && SUSPICIOUS_DECODED_RE.test(deobfuscated)) {
    return { matched: true, reason: 'percent-encoded payload decodes to suspicious content' };
  }

  for (const match of blob.matchAll(BASE64_BLOB_RE)) {
    const b64 = match[1];
    const decoded = tryDecodeBase64(b64);
    if (decoded && SUSPICIOUS_DECODED_RE.test(decoded)) {
      return { matched: true, reason: 'base64 blob decodes to suspicious instruction text' };
    }
  }

  for (const match of blob.matchAll(RAW_HEX_BLOB_RE)) {
    const hex = match[1];
    const decoded = tryDecodeRawHex(hex);
    if (decoded && SUSPICIOUS_DECODED_RE.test(decoded)) {
      return { matched: true, reason: 'raw hex blob decodes to suspicious instruction text' };
    }
  }

  const trimmed = blob.trim();
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    const whole = tryDecodeBase64(trimmed);
    if (whole && SUSPICIOUS_DECODED_RE.test(whole)) {
      return { matched: true, reason: 'whole-string base64 decodes to suspicious content' };
    }
  }

  return { matched: false, reason: '' };
}

export function evaluateEncodingGuard(ctx: CallContext): PolicyDecision | null {
  if (!isEncodingGuardEnabled()) return null;

  const blob = walkStringLeaves(ctx.arguments ?? {})
    .map((l) => l.value)
    .join('\n');
  if (!blob.trim()) return null;

  const scan = scanEncodingEvasion(blob);
  if (!scan.matched) return null;

  return {
    action: 'block',
    rule: 'encoding-evasion-guard',
    reason: scan.reason,
  };
}
