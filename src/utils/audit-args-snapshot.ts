/**
 * Redacted tool-call argument snapshots for counterfactual replay and audit evidence.
 */
import { walkStringLeaves } from '../policy/arg-leaf-walker.js';

const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|password|token|authorization)\s*[:=]\s*['"]?([^\s'"]{8,})/gi,
  /\bsk-ant-[a-zA-Z0-9_-]{10,}\b/g,
  /\bsk-[a-zA-Z0-9]{20,}\b/g,
  /\bghp_[a-zA-Z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g,
];

const MAX_STRING_LEN = parseInt(process.env.MASTYF_AI_AUDIT_ARGS_MAX_STRING || '512', 10);
const MAX_KEYS = parseInt(process.env.MASTYF_AI_AUDIT_ARGS_MAX_KEYS || '32', 10);

function redactString(value: string): string {
  let out = value.length > MAX_STRING_LEN ? `${value.slice(0, MAX_STRING_LEN)}…` : value;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

/** The same secret scrub, for text that is already a snippet. */
export function redactSecretsInText(value: string): string {
  return redactString(value);
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]';
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => redactValue(v, depth + 1));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).slice(0, MAX_KEYS);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = redactValue(obj[k], depth + 1);
    }
    if (Object.keys(obj).length > MAX_KEYS) out._truncated = true;
    return out;
  }
  return String(value);
}

/** Store a privacy-safe snapshot suitable for replay and compliance evidence. */
export function snapshotAuditArguments(args?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!args || !Object.keys(args).length) return undefined;
  const redacted = redactValue(args) as Record<string, unknown>;
  if (!Object.keys(redacted).length) return undefined;
  return redacted;
}

export function argsFingerprint(args?: Record<string, unknown>): string {
  if (!args) return '';
  return walkStringLeaves(args)
    .map((l) => `${l.path}:${l.value.length}`)
    .join('|')
    .slice(0, 200);
}
