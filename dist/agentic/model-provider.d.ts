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
export type ModelProvider = 'openai' | 'anthropic' | 'openai-compatible';
export interface LlmConfig {
    provider: ModelProvider;
    apiKey: string;
    baseUrl?: string;
    model: string;
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
}
export interface LlmCompletionRequest {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    /** JSON schema for structured output (OpenAI-compatible APIs only) */
    responseFormat?: {
        type: 'json_object' | 'json_schema';
        schema?: object;
    };
}
export interface LlmCompletionResponse {
    content: string;
    parsedJson?: unknown;
    model: string;
    provider: ModelProvider;
    tokensUsed: {
        input: number;
        output: number;
        total: number;
    };
    latencyMs: number;
}
export declare class AgenticModelProvider {
    private configs;
    private initialized;
    constructor();
    /** Load LLM configurations from environment variables. */
    private loadConfigsFromEnv;
    /** Check if any LLM is available. */
    isAvailable(): boolean;
    /** Get the list of configured providers. */
    getProviders(): ModelProvider[];
    /**
     * Send a completion request to the first available provider.
     * Tries providers in order; falls back on failure.
     */
    complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse | null>;
    /** Send to a specific provider. */
    private sendToProvider;
    /** Send to OpenAI-compatible API. */
    private sendOpenAI;
    /** Send to Anthropic API. */
    private sendAnthropic;
    /**
     * Simple heuristic classifier — used when no LLM is available.
     * Returns a confidence score based on keyword matching.
     */
    heuristicClassify(input: string, patterns: {
        category: string;
        keywords: string[];
        weight: number;
    }[]): {
        category: string;
        confidence: number;
    };
}
//# sourceMappingURL=model-provider.d.ts.map