import { getScanToolTimeoutMaxMs } from '../scan-timeouts.js';
import { redactSecrets } from './redact-secrets.js';
let cached = null;
function resolveProvider() {
    const explicit = process.env.MASTYF_AI_LLM_PROVIDER?.toLowerCase();
    if (explicit === 'anthropic' || explicit === 'openai' || explicit === 'ollama') {
        return explicit;
    }
    if (process.env.ANTHROPIC_API_KEY)
        return 'anthropic';
    if (process.env.OPENAI_API_KEY)
        return 'openai';
    return 'ollama';
}
function defaultModelForProvider(provider) {
    switch (provider) {
        case 'anthropic':
            return 'claude-haiku-4-5-20251001';
        case 'openai':
            return 'gpt-4o-mini';
        case 'ollama':
            return 'qwen3:8b';
    }
}
function resolveTimeoutMs() {
    const raw = parseInt(process.env.MASTYF_AI_SEMANTIC_LLM_TIMEOUT_MS
        || process.env.MASTYF_AI_LLM_TIMEOUT_MS
        || '30000', 10);
    const base = Number.isFinite(raw) && raw > 0 ? raw : 30_000;
    return Math.min(base, getScanToolTimeoutMaxMs());
}
export function getLlmConfig() {
    if (cached)
        return cached;
    const provider = resolveProvider();
    const model = process.env.MASTYF_AI_LLM_MODEL || defaultModelForProvider(provider);
    cached = {
        provider,
        model,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        openaiApiKey: process.env.OPENAI_API_KEY,
        ollamaBaseUrl: process.env.OLLAMA_BASE_URL ||
            process.env.OLLAMA_URL ||
            'http://localhost:11434',
        maxTokens: parseInt(process.env.MASTYF_AI_LLM_MAX_TOKENS || '512', 10),
        timeoutMs: resolveTimeoutMs(),
        temperature: parseFloat(process.env.MASTYF_AI_LLM_TEMPERATURE || '0.1'),
        enabled: process.env.MASTYF_AI_LLM_ENABLED !== 'false',
    };
    return cached;
}
/** Safe snapshot for debug logging (secrets redacted). */
export function getLlmConfigForLogging() {
    return redactSecrets(getLlmConfig());
}
export function resetLlmConfigForTests() {
    cached = null;
}
//# sourceMappingURL=llm-config.js.map