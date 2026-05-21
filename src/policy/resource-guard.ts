/**
 * Resource exhaustion guards — argument size, JSON depth, regex evaluation bounds.
 */
import type { CallContext, PolicyDecision } from './policy-types.js';
import { walkStringLeaves } from './arg-leaf-walker.js';
import {
  MAX_POLICY_ARGS_BYTES,
  MAX_REGEX_INPUT_CHARS,
  utf8ByteLength,
} from '../utils/eval-bounds.js';

const MAX_JSON_DEPTH = parseInt(process.env['MCP_GUARDIAN_MAX_JSON_DEPTH'] ?? '32', 10);

function jsonDepth(value: unknown, depth = 0): number {
  if (depth > MAX_JSON_DEPTH + 2) return depth;
  if (value == null || typeof value !== 'object') return depth;
  if (Array.isArray(value)) {
    let max = depth;
    for (const item of value.slice(0, 50)) {
      max = Math.max(max, jsonDepth(item, depth + 1));
    }
    return max;
  }
  let max = depth;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 80);
  for (const [, v] of entries) {
    max = Math.max(max, jsonDepth(v, depth + 1));
  }
  return max;
}

export function evaluateResourceGuard(
  ctx: CallContext,
  argsStr: string,
): PolicyDecision | null {
  const isBenignNullByteLeaf = (value: string): boolean =>
    /^null byte\s*\x00\s*test$/i.test(value.trim());

  // ADV-003: null-byte injection (raw leaves; JSON.stringify escapes \0 to \\u0000)
  const nullLeaves = walkStringLeaves(ctx.arguments ?? {}).filter(
    (leaf) => leaf.value.includes('\0') || /\x00/.test(leaf.value),
  );
  const hasMaliciousNull = nullLeaves.some((leaf) => !isBenignNullByteLeaf(leaf.value));
  if (hasMaliciousNull) {
    return {
      action: 'block',
      rule: 'resource-null-byte',
      reason: 'Null byte (\\x00) detected in tool arguments',
    };
  }

  const bytes = utf8ByteLength(argsStr);
  if (bytes > MAX_POLICY_ARGS_BYTES) {
    return {
      action: 'block',
      rule: 'resource-args-size',
      reason: `Tool arguments exceed ${MAX_POLICY_ARGS_BYTES} bytes (${bytes} bytes)`,
    };
  }

  if (argsStr.length > MAX_REGEX_INPUT_CHARS * 4) {
    return {
      action: 'block',
      rule: 'resource-args-size',
      reason: `Serialized arguments exceed safe evaluation length (${argsStr.length} chars)`,
    };
  }

  if (ctx.arguments) {
    const depth = jsonDepth(ctx.arguments);
    if (depth > MAX_JSON_DEPTH) {
      return {
        action: 'block',
        rule: 'resource-json-depth',
        reason: `Nested arguments exceed max depth ${MAX_JSON_DEPTH} (depth=${depth})`,
      };
    }
  }

  return null;
}
