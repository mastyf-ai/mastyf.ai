export interface LlmAssistantConfig {
    model: string;
    ollamaUrl: string;
    timeoutMs: number;
    enabled: boolean;
    maxRetries: number;
    maxTokens: number;
    temperature: number;
    /** When false, use full timeoutMs (Threat Lab / batch jobs, not proxy hot path). */
    hotPath?: boolean;
}
export declare function resolveOllamaBaseUrl(explicit?: string): string;
export interface LlmResponse {
    text: string;
    model: string;
    tokensUsed: number;
    durationMs: number;
}
export interface LlmHealthStatus {
    ok: boolean;
    reason?: string;
    endpoint: string;
}
export declare class LlmAssistant {
    private config;
    constructor(config?: Partial<LlmAssistantConfig>);
    /** Check if Ollama is reachable */
    healthCheck(): Promise<boolean>;
    healthCheckDetailed(): Promise<LlmHealthStatus>;
    /**
     * Generate completion using local Ollama model.
     * Returns null if unavailable or disabled.
     */
    generate(systemPrompt: string, userPrompt: string): Promise<LlmResponse | null>;
    /**
     * Generate a YAML policy rule from a natural language goal.
     */
    generatePolicyRule(goal: string, availableTools?: string[]): Promise<{
        yaml: string;
        explanation: string;
    } | null>;
    /**
     * Explain an anomaly detected by BaselineLearner in human language.
     */
    explainAnomaly(params: {
        serverName: string;
        toolName: string;
        metric: string;
        zScore: number;
        expectedValue: number;
        actualValue: number;
        historicalSamples: number;
    }): Promise<string | null>;
    /**
     * Analyze a CVE and suggest targeted blocking rules.
     */
    analyzeThreat(params: {
        cveId: string;
        severity: string;
        description: string;
        affectedPackage: string;
    }): Promise<{
        impact: string;
        suggestedPatterns: string[];
        action: string;
    } | null>;
    /**
     * Synthesize cross-layer insights into an executive summary.
     */
    synthesizeInsights(insights: Array<{
        type: string;
        severity: string;
        description: string;
    }>): Promise<string | null>;
    /** Check if LLM is enabled and available */
    isAvailable(): boolean;
    getModel(): string;
    getOllamaUrl(): string;
}
//# sourceMappingURL=llm-assistant.d.ts.map