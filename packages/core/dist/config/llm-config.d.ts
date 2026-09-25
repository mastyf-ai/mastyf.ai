export type LlmProvider = 'anthropic' | 'openai' | 'ollama';
export interface LlmConfig {
    provider: LlmProvider;
    model: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
    ollamaBaseUrl: string;
    maxTokens: number;
    timeoutMs: number;
    temperature: number;
    enabled: boolean;
}
export declare function getLlmConfig(): LlmConfig;
/** Safe snapshot for debug logging (secrets redacted). */
export declare function getLlmConfigForLogging(): Omit<LlmConfig, 'anthropicApiKey' | 'openaiApiKey'> & {
    anthropicApiKey?: string;
    openaiApiKey?: string;
};
export declare function resetLlmConfigForTests(): void;
//# sourceMappingURL=llm-config.d.ts.map