import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
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
/** Centralized LLM settings — read env once per process. */
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
        timeoutMs: parseInt(process.env.MASTYF_AI_LLM_TIMEOUT_MS || '30000', 10),
        temperature: parseFloat(process.env.MASTYF_AI_LLM_TEMPERATURE || '0.1'),
        enabled: process.env.MASTYF_AI_LLM_ENABLED !== 'false',
    };
    return cached;
}
export function resetLlmConfigForTests() {
    cached = null;
    lastLlmSecretRefreshAt = 0;
}
let lastLlmSecretRefreshAt = 0;
let llmSecretRefreshTimer = null;
/** Reload LLM API keys from secret provider (for rotation without restart). */
export async function refreshLlmApiKeysFromSecretProvider() {
    const { createSecretProvider } = await import('../auth/secret-provider.js');
    const provider = createSecretProvider();
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
        const value = await provider.get(key);
        if (value)
            process.env[key] = value;
    }
    cached = null;
    lastLlmSecretRefreshAt = Date.now();
}
/** Start periodic LLM key refresh when MASTYF_AI_LLM_SECRET_REFRESH_MS is set. */
export function startLlmSecretRefreshTimer() {
    stopLlmSecretRefreshTimer();
    const ms = parseInt(process.env.MASTYF_AI_LLM_SECRET_REFRESH_MS || '0', 10);
    if (!Number.isFinite(ms) || ms <= 0)
        return () => { };
    void refreshLlmApiKeysFromSecretProvider();
    llmSecretRefreshTimer = setInterval(() => {
        void refreshLlmApiKeysFromSecretProvider();
    }, ms);
    return stopLlmSecretRefreshTimer;
}
export function stopLlmSecretRefreshTimer() {
    if (llmSecretRefreshTimer) {
        clearInterval(llmSecretRefreshTimer);
        llmSecretRefreshTimer = null;
    }
}
const GLOBAL_MODEL_ENV_KEYS = [
    'MASTYF_AI_MODEL',
    'MASTYF_AI_LLM_MODEL',
    'ANTHROPIC_MODEL',
    'OPENAI_MODEL',
    'MCP_PRICING_MODEL',
    'MCP_MODEL',
    'MODEL',
    'CURSOR_MODEL',
    'CLINE_MODEL',
];
const SERVER_MODEL_ENV_KEYS = [
    'MASTYF_AI_MODEL',
    'MASTYF_AI_LLM_MODEL',
    'ANTHROPIC_MODEL',
    'OPENAI_MODEL',
    'MCP_MODEL',
    'MODEL',
];
function firstNonEmpty(...values) {
    for (const v of values) {
        const t = v?.trim();
        if (t)
            return t;
    }
    return undefined;
}
/** Read act-mode model id from Cline globalState (IDE), when present. */
function readClineActModeModelId() {
    const statePath = join(homedir(), '.cline', 'data', 'globalState.json');
    if (!existsSync(statePath))
        return undefined;
    try {
        const state = JSON.parse(readFileSync(statePath, 'utf-8'));
        return firstNonEmpty(String(state.actModeClineModelId || ''), String(state.actModeAnthropicModelId || ''), String(state.actModeOpenAiModelId || ''), String(state.actModeGeminiModelId || ''), String(state.actModeGroqModelId || ''), String(state.actModeOpenRouterModelId || ''));
    }
    catch {
        return undefined;
    }
}
/** Parse `--model`, `--model=id`, or trailing model flags from MCP server args. */
export function extractModelFromServerArgs(args) {
    if (!args?.length)
        return undefined;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--model' || a === '-m') {
            const next = args[i + 1]?.trim();
            if (next)
                return next;
        }
        if (a.startsWith('--model=')) {
            const v = a.slice('--model='.length).trim();
            if (v)
                return v;
        }
        const modelEq = a.match(/(?:^|,)model=([^,]+)/i);
        if (modelEq?.[1]?.trim())
            return modelEq[1].trim();
    }
    return undefined;
}
/**
 * Model discovery chain (first match wins):
 *
 * **Per-server (audit / proxy record time)**
 * 1. MCP server `env` — MASTYF_AI_MODEL, MASTYF_AI_LLM_MODEL, ANTHROPIC_MODEL, OPENAI_MODEL, MCP_MODEL, MODEL
 * 2. MCP server `args` — `--model`, `-m`, `--model=id`
 * 3. Process env `MASTYF_AI_MODEL_<NORMALIZED_SERVER_NAME>`
 *
 * **Global / IDE**
 * 4. `resolveModelId(payloadModel)` — message metadata, then MASTYF_AI_MODEL, ANTHROPIC_MODEL, OPENAI_MODEL,
 *    MCP_PRICING_MODEL, CURSOR_MODEL, CLINE_MODEL, MASTYF_AI_LLM_MODEL, `getLlmConfig().model`
 * 5. Cline `~/.cline/data/globalState.json` act-mode model ids (when no env model)
 */
export function resolveModelId(payloadModel) {
    const fromPayload = payloadModel?.trim();
    if (fromPayload)
        return fromPayload;
    for (const key of GLOBAL_MODEL_ENV_KEYS) {
        const v = process.env[key]?.trim();
        if (v)
            return v;
    }
    const cline = readClineActModeModelId();
    if (cline)
        return cline;
    return getLlmConfig().model;
}
/** Per-server model: server env → args → MASTYF_AI_MODEL_<SERVER> → global resolveModelId(). */
export function resolveModelIdForServer(serverName, serverEnv, serverArgs) {
    for (const key of SERVER_MODEL_ENV_KEYS) {
        const v = serverEnv?.[key]?.trim();
        if (v)
            return v;
    }
    const fromArgs = extractModelFromServerArgs(serverArgs);
    if (fromArgs)
        return fromArgs;
    const normalized = serverName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const perServer = process.env[`MASTYF_AI_MODEL_${normalized}`]?.trim();
    if (perServer)
        return perServer;
    return resolveModelId();
}
//# sourceMappingURL=llm-config.js.map