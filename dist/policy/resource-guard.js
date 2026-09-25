import { walkStringLeaves } from './arg-leaf-walker.js';
import { MAX_POLICY_ARGS_BYTES, MAX_REGEX_INPUT_CHARS, utf8ByteLength, } from '../utils/eval-bounds.js';
const MAX_JSON_DEPTH = parseInt(process.env['MASTYF_AI_MAX_JSON_DEPTH'] ?? '32', 10);
function jsonDepth(value, depth = 0) {
    if (depth > MAX_JSON_DEPTH + 2)
        return depth;
    if (value == null || typeof value !== 'object')
        return depth;
    if (Array.isArray(value)) {
        let max = depth;
        for (const item of value.slice(0, 50)) {
            max = Math.max(max, jsonDepth(item, depth + 1));
        }
        return max;
    }
    let max = depth;
    const entries = Object.entries(value).slice(0, 80);
    for (const [, v] of entries) {
        max = Math.max(max, jsonDepth(v, depth + 1));
    }
    return max;
}
export function evaluateResourceGuard(ctx, argsStr, rawArguments) {
    const hasEscapedNullByte = (value) => /\\x00|\\u0000|%00|(?:^|[^a-z0-9])x00(?:[^a-z0-9]|$)/i.test(value);
    const isBenignNullByteLeaf = (value) => /^null byte\s*\x00\s*test$/i.test(value.trim());
    // ADV-003: null-byte injection (raw leaves; JSON.stringify escapes \0 to \\u0000)
    const nullLeaves = [
        ...walkStringLeaves(ctx.arguments ?? {}),
        ...walkStringLeaves(rawArguments ?? {}),
    ].filter((leaf) => leaf.value.includes('\0') || /\x00/.test(leaf.value) || hasEscapedNullByte(leaf.value));
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
//# sourceMappingURL=resource-guard.js.map