/**
 * Multi-layer encoding evasion detection — base64, hex, URL chains, and
 * mismatch between raw arguments and deobfuscated content.
 */
import type { CallContext, PolicyDecision } from './policy-types.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import { deobfuscateRecursive, stripZeroWidthCharacters } from '../utils/payload-normalizer.js';
import { detectPromptInjection } from '../scanners/prompt-injection-detector.js';
import { OVERRIDE_ATTACK_RE, SUSPICIOUS_DECODED_RE } from './encoding-guard-patterns.js';

const BASE64_BLOB_RE = /(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{20,}={0,2})(?:[^A-Za-z0-9+/]|$)/g;
const RAW_HEX_BLOB_RE = /\b([0-9a-fA-F]{16,})\b/g;
const PERCENT_ENCODED_RUN_RE = /(?:%[0-9a-fA-F]{2}){4,}/i;
const SHELL_FRAGMENT_RE =
  /\b(?:rm\s+-rf|union\s+select|sleep\s*\(|benchmark\s*\(|\/etc\/passwd|\/bin\/sh|select\s+\*|\/dev\/tcp|delete\s+account|drop\s+table)\b/i;

function encodingTransformApplied(original: string, decoded: string): boolean {
  if (decoded.length === 0 || decoded === original) return false;
  const norm = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  if (norm(original) === norm(decoded)) return false;
  return true;
}

/** After a real encoding transform, run keyword union + injection detector. */
function decodedContentSuspicious(original: string, decoded: string): boolean {
  if (!encodingTransformApplied(original, decoded)) return false;
  if (
    SUSPICIOUS_DECODED_RE.test(decoded)
    || OVERRIDE_ATTACK_RE.test(decoded)
    || SHELL_FRAGMENT_RE.test(decoded)
  ) {
    return true;
  }
  const findings = detectPromptInjection('encoding-guard', decoded);
  return findings.some((f) => f.severity === 'critical' || f.severity === 'high');
}

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
  const strippedInvisible = stripZeroWidthCharacters(blob);
  if (decodedContentSuspicious(blob, deobfuscated)) {
    return { matched: true, reason: 'multi-layer encoding reveals blocked content after decode' };
  }
  if (strippedInvisible !== blob && decodedContentSuspicious(blob, strippedInvisible)) {
    return { matched: true, reason: 'zero-width stripped content is suspicious after decode' };
  }

  if (PERCENT_ENCODED_RUN_RE.test(blob) && decodedContentSuspicious(blob, deobfuscated)) {
    return { matched: true, reason: 'percent-encoded payload decodes to suspicious content' };
  }

  for (const match of blob.matchAll(BASE64_BLOB_RE)) {
    const b64 = match[1];
    const decoded = tryDecodeBase64(b64);
    if (decoded && decodedContentSuspicious(b64, decoded)) {
      return { matched: true, reason: 'base64 blob decodes to suspicious instruction text' };
    }
  }

  for (const match of blob.matchAll(RAW_HEX_BLOB_RE)) {
    const hex = match[1];
    const decoded = tryDecodeRawHex(hex);
    if (decoded && decodedContentSuspicious(hex, decoded)) {
      return { matched: true, reason: 'raw hex blob decodes to suspicious instruction text' };
    }
  }

  const trimmed = blob.trim();
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    const whole = tryDecodeBase64(trimmed);
    if (whole && decodedContentSuspicious(trimmed, whole)) {
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
