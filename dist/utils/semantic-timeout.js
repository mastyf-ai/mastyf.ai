import { StructuredLogger } from './structured-logger.js';
import { Logger } from './logger.js';
const DEFAULT_MS = 500;
const DEFAULT_INSTANT_LLM_MS = 500;
/** Hot-path semantic/LLM budget (default 500ms). */
export function getSemanticTimeoutMs() {
    const raw = process.env['MASTYF_AI_SEMANTIC_TIMEOUT_MS'];
    if (raw === undefined || raw === '')
        return DEFAULT_MS;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MS;
}
/** Instant attack-learning LLM budget (default 500ms). */
export function getInstantLlmTimeoutMs() {
    const raw = process.env['MASTYF_AI_AI_INSTANT_LLM_TIMEOUT_MS'];
    if (raw === undefined || raw === '')
        return DEFAULT_INSTANT_LLM_MS;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_INSTANT_LLM_MS;
}
export class SemanticTimeoutError extends Error {
    constructor(message = 'semantic_timeout') {
        super(message);
        this.name = 'SemanticTimeoutError';
    }
}
/**
 * Race `fn()` against a timeout. On timeout logs `semantic_timeout` and returns `fallback`.
 */
export async function withSemanticTimeout(label, fn, fallback, timeoutMs = getSemanticTimeoutMs()) {
    let timer;
    try {
        return await Promise.race([
            fn(),
            new Promise((resolve) => {
                timer = setTimeout(() => {
                    Logger.warn(`[semantic] timeout after ${timeoutMs}ms (${label})`);
                    StructuredLogger.info({
                        event: 'semantic_timeout',
                        label,
                        timeoutMs,
                    });
                    if (label === 'async_semantic_audit') {
                        void import('./metrics.js').then((m) => {
                            m.semanticAsyncTimeoutTotal.inc({ label });
                        });
                    }
                    resolve(fallback);
                }, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
//# sourceMappingURL=semantic-timeout.js.map