/**
 * Agentic Model Provider — unified LLM interface for semantic agentic features.
 *
 * Supports:
 *   - OpenAI-compatible APIs (OpenAI, Azure, local Ollama/LM Studio)
 *   - Anthropic Claude
 *   - Configurable via MASTYF_AI_LLM_* env vars
 *   - Fallback ordering and retry
 *   - Token usage tracking for cost audit
 */
import { Logger } from '../utils/logger.js';
export class AgenticModelProvider {
    configs = [];
    initialized = false;
    constructor() {
        this.loadConfigsFromEnv();
    }
    /** Load LLM configurations from environment variables. */
    loadConfigsFromEnv() {
        // OpenAI
        if (process.env['MASTYF_AI_LLM_OPENAI_KEY'] || process.env['OPENAI_API_KEY']) {
            this.configs.push({
                provider: 'openai',
                apiKey: process.env['MASTYF_AI_LLM_OPENAI_KEY'] || process.env['OPENAI_API_KEY'],
                baseUrl: process.env['MASTYF_AI_LLM_OPENAI_BASE_URL'],
                model: process.env['MASTYF_AI_LLM_OPENAI_MODEL'] || 'gpt-4o-mini',
                timeoutMs: parseInt(process.env['MASTYF_AI_LLM_TIMEOUT_MS'] || '15000', 10),
            });
        }
        // Anthropic
        if (process.env['MASTYF_AI_LLM_ANTHROPIC_KEY'] || process.env['ANTHROPIC_API_KEY']) {
            this.configs.push({
                provider: 'anthropic',
                apiKey: process.env['MASTYF_AI_LLM_ANTHROPIC_KEY'] || process.env['ANTHROPIC_API_KEY'],
                model: process.env['MASTYF_AI_LLM_ANTHROPIC_MODEL'] || 'claude-3-5-haiku-latest',
                timeoutMs: parseInt(process.env['MASTYF_AI_LLM_TIMEOUT_MS'] || '15000', 10),
            });
        }
        // OpenAI-compatible (e.g., Ollama, LM Studio, Groq)
        if (process.env['MASTYF_AI_LLM_COMPATIBLE_KEY'] && process.env['MASTYF_AI_LLM_COMPATIBLE_BASE_URL']) {
            this.configs.push({
                provider: 'openai-compatible',
                apiKey: process.env['MASTYF_AI_LLM_COMPATIBLE_KEY'],
                baseUrl: process.env['MASTYF_AI_LLM_COMPATIBLE_BASE_URL'],
                model: process.env['MASTYF_AI_LLM_COMPATIBLE_MODEL'] || 'llama3',
                timeoutMs: parseInt(process.env['MASTYF_AI_LLM_TIMEOUT_MS'] || '15000', 10),
            });
        }
        this.initialized = this.configs.length > 0;
        if (this.initialized) {
            Logger.info(`[AgenticModelProvider] Loaded ${this.configs.length} LLM config(s): ${this.configs.map(c => `${c.provider}/${c.model}`).join(', ')}`);
        }
        else {
            Logger.info('[AgenticModelProvider] No LLM configured — semantic features will use heuristic fallbacks only');
        }
    }
    /** Check if any LLM is available. */
    isAvailable() {
        return this.initialized;
    }
    /** Get the list of configured providers. */
    getProviders() {
        return this.configs.map(c => c.provider);
    }
    /**
     * Send a completion request to the first available provider.
     * Tries providers in order; falls back on failure.
     */
    async complete(request) {
        if (!this.initialized) {
            Logger.warn('[AgenticModelProvider] Cannot complete — no LLM configured');
            return null;
        }
        const errors = [];
        for (const config of this.configs) {
            try {
                const start = Date.now();
                const response = await this.sendToProvider(config, request);
                const latencyMs = Date.now() - start;
                Logger.debug(`[AgenticModelProvider] ${config.provider}/${config.model} completed in ${latencyMs}ms (${response.tokensUsed.total} tokens)`);
                return response;
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                errors.push(`${config.provider}: ${message}`);
                Logger.warn(`[AgenticModelProvider] ${config.provider} failed: ${message}, trying next...`);
            }
        }
        Logger.error(`[AgenticModelProvider] All providers failed: ${errors.join('; ')}`);
        return null;
    }
    /** Send to a specific provider. */
    async sendToProvider(config, request) {
        switch (config.provider) {
            case 'openai':
            case 'openai-compatible':
                return this.sendOpenAI(config, request);
            case 'anthropic':
                return this.sendAnthropic(config, request);
            default:
                throw new Error(`Unknown provider: ${config.provider}`);
        }
    }
    /** Send to OpenAI-compatible API. */
    async sendOpenAI(config, request) {
        const url = config.baseUrl
            ? `${config.baseUrl.replace(/\/$/, '')}/chat/completions`
            : 'https://api.openai.com/v1/chat/completions';
        const body = {
            model: config.model,
            messages: [
                { role: 'system', content: request.systemPrompt },
                { role: 'user', content: request.userPrompt },
            ],
            max_tokens: request.maxTokens || config.maxTokens || 1024,
            temperature: request.temperature ?? config.temperature ?? 0.2,
        };
        if (request.responseFormat) {
            body['response_format'] = request.responseFormat;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 15000);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
            }
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';
            let parsedJson;
            if (request.responseFormat?.type === 'json_object' || request.responseFormat?.type === 'json_schema') {
                try {
                    parsedJson = JSON.parse(content);
                }
                catch {
                    // Content wasn't valid JSON — return as-is
                }
            }
            return {
                content,
                parsedJson,
                model: data.model || config.model,
                provider: config.provider,
                tokensUsed: {
                    input: data.usage?.prompt_tokens || 0,
                    output: data.usage?.completion_tokens || 0,
                    total: data.usage?.total_tokens || 0,
                },
                latencyMs: 0, // set by caller
            };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    /** Send to Anthropic API. */
    async sendAnthropic(config, request) {
        const url = 'https://api.anthropic.com/v1/messages';
        const body = {
            model: config.model,
            max_tokens: request.maxTokens || config.maxTokens || 1024,
            temperature: request.temperature ?? config.temperature ?? 0.2,
            system: request.systemPrompt,
            messages: [{ role: 'user', content: request.userPrompt }],
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 15000);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
            }
            const data = await response.json();
            const textContent = data.content?.find(c => c.type === 'text');
            const content = textContent?.text || '';
            let parsedJson;
            if (request.responseFormat) {
                try {
                    // Anthropic doesn't have native JSON mode, so attempt to parse
                    const jsonMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonMatch)
                        parsedJson = JSON.parse(jsonMatch[0]);
                }
                catch {
                    // Not valid JSON
                }
            }
            return {
                content,
                parsedJson,
                model: data.model || config.model,
                provider: 'anthropic',
                tokensUsed: {
                    input: data.usage?.input_tokens || 0,
                    output: data.usage?.output_tokens || 0,
                    total: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
                },
                latencyMs: 0, // set by caller
            };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    /**
     * Simple heuristic classifier — used when no LLM is available.
     * Returns a confidence score based on keyword matching.
     */
    heuristicClassify(input, patterns) {
        const lower = input.toLowerCase();
        let bestCategory = 'benign';
        let bestConfidence = 0;
        for (const pattern of patterns) {
            let matches = 0;
            for (const kw of pattern.keywords) {
                if (lower.includes(kw.toLowerCase())) {
                    matches++;
                }
            }
            const confidence = (matches / pattern.keywords.length) * pattern.weight;
            if (confidence > bestConfidence) {
                bestConfidence = confidence;
                bestCategory = pattern.category;
            }
        }
        return { category: bestCategory, confidence: Math.min(bestConfidence, 1) };
    }
}
//# sourceMappingURL=model-provider.js.map