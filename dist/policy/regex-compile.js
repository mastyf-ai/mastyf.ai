/**
 * Safe policy regex compilation — YAML escape normalization + ReDoS hardening.
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { MAX_POLICY_REGEX_SOURCE_LEN } from '../utils/eval-bounds.js';
import { Logger } from '../utils/logger.js';
const REGEX_EVAL_TIMEOUT_MS = parseInt(process.env.MASTYF_AI_REGEX_EVAL_TIMEOUT_MS || '50', 10);
const WORKER_SCRIPT = fileURLToPath(new URL('./regex-eval-worker.mjs', import.meta.url));
/** Normalize YAML-escaped policy patterns before RegExp construction. */
export function normalizePolicyRegexSource(pattern) {
    return pattern.includes('\\\\') ? pattern.replace(/\\\\/g, '\\') : pattern;
}
/** Patterns associated with catastrophic backtracking when applied to large inputs. */
const REDOS_RISK = /(\([^)]*[+*][^)]*\)[+*{])|(\(\?[^)]*\)[+*{])|(\.\*){2,}|(\.\+){2,}|(\[[^\]]*[+*]{2,})|(\([^)]*\|[^)]*\)[+*])/;
export function isRegexPatternSafe(pattern) {
    const normalized = normalizePolicyRegexSource(pattern);
    if (normalized.length > MAX_POLICY_REGEX_SOURCE_LEN) {
        return { safe: false, reason: `Pattern exceeds ${MAX_POLICY_REGEX_SOURCE_LEN} characters` };
    }
    if (REDOS_RISK.test(normalized)) {
        return { safe: false, reason: 'Nested/greedy quantifier ReDoS risk' };
    }
    try {
        new RegExp(normalized, 'i');
    }
    catch (e) {
        return { safe: false, reason: e instanceof Error ? e.message : 'Invalid regex' };
    }
    return { safe: true };
}
export function shouldRejectUnsafePolicyRegex() {
    if (process.env.MASTYF_AI_POLICY_REJECT_UNSAFE_REGEX === 'false')
        return false;
    if (process.env.MASTYF_AI_POLICY_REJECT_UNSAFE_REGEX === 'true')
        return true;
    return process.env.NODE_ENV === 'production';
}
export class UnsafePolicyRegexError extends Error {
    pattern;
    constructor(message, pattern) {
        super(message);
        this.pattern = pattern;
        this.name = 'UnsafePolicyRegexError';
    }
}
export function compilePolicyRegex(pattern, flags = 'i') {
    const check = isRegexPatternSafe(pattern);
    if (!check.safe) {
        const msg = `Policy: rejecting unsafe regex — ${check.reason}: ${pattern.slice(0, 80)}`;
        if (shouldRejectUnsafePolicyRegex()) {
            throw new UnsafePolicyRegexError(msg, pattern);
        }
        Logger.warn(msg);
        return /(?!)/;
    }
    return new RegExp(normalizePolicyRegexSource(pattern), flags);
}
/** Use worker-thread eval when enabled (default on in production). */
export function shouldUseRegexWorker() {
    if (process.env.MASTYF_AI_REGEX_USE_WORKER === 'false')
        return false;
    if (process.env.MASTYF_AI_REGEX_USE_WORKER === 'true')
        return true;
    return process.env.NODE_ENV === 'production';
}
function safeRegexTestInline(regex, input) {
    const start = Date.now();
    try {
        const matched = regex.test(input);
        const elapsed = Date.now() - start;
        if (elapsed > REGEX_EVAL_TIMEOUT_MS) {
            Logger.warn(`[policy] Regex eval exceeded ${REGEX_EVAL_TIMEOUT_MS}ms (${elapsed}ms) — treating as non-match`);
            return false;
        }
        return matched;
    }
    catch (e) {
        Logger.warn(`[policy] Regex eval error: ${e instanceof Error ? e.message : String(e)}`);
        return false;
    }
}
function safeRegexTestWorker(regex, input) {
    const sab = new SharedArrayBuffer(8);
    const state = new Int32Array(sab);
    let worker = null;
    try {
        worker = new Worker(WORKER_SCRIPT, {
            workerData: {
                sab,
                source: regex.source,
                flags: regex.flags,
                input,
            },
        });
        const waitResult = Atomics.wait(state, 0, 0, REGEX_EVAL_TIMEOUT_MS + 25);
        if (waitResult === 'timed-out' || Atomics.load(state, 0) !== 1) {
            Logger.warn(`[policy] Regex worker eval exceeded ${REGEX_EVAL_TIMEOUT_MS}ms — treating as non-match`);
            return false;
        }
        return Atomics.load(state, 1) === 1;
    }
    catch (e) {
        Logger.warn(`[policy] Regex worker failed (${e instanceof Error ? e.message : String(e)}) — inline fallback`);
        return safeRegexTestInline(regex, input);
    }
    finally {
        void worker?.terminate();
    }
}
/** Run regex.test with bounded input length and worker-thread or wall-clock budget. */
export function safeRegexTest(regex, value, maxChars) {
    const input = value.length > maxChars ? value.slice(0, maxChars) : value;
    if (shouldUseRegexWorker()) {
        return safeRegexTestWorker(regex, input);
    }
    return safeRegexTestInline(regex, input);
}
//# sourceMappingURL=regex-compile.js.map