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
/** Centralized LLM settings — read env once per process. */
export declare function getLlmConfig(): LlmConfig;
export declare function resetLlmConfigForTests(): void;
/** Reload LLM API keys from secret provider (for rotation without restart). */
export declare function refreshLlmApiKeysFromSecretProvider(): Promise<void>;
/** Start periodic LLM key refresh when MASTYF_AI_LLM_SECRET_REFRESH_MS is set. */
export declare function startLlmSecretRefreshTimer(): () => void;
export declare function stopLlmSecretRefreshTimer(): void;
/** Parse `--model`, `--model=id`, or trailing model flags from MCP server args. */
export declare function extractModelFromServerArgs(args?: string[]): string | undefined;
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
export declare function resolveModelId(payloadModel?: string | null): string;
/** Per-server model: server env → args → MASTYF_AI_MODEL_<SERVER> → global resolveModelId(). */
export declare function resolveModelIdForServer(serverName: string, serverEnv?: Record<string, string>, serverArgs?: string[]): string;
//# sourceMappingURL=llm-config.d.ts.map