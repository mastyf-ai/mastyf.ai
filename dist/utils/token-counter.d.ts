export type TokenProvider = 'openai' | 'anthropic' | 'google' | 'unknown';
export type TokenSource = 'api' | 'estimated';
export interface TokenCountResult {
    tokens: number;
    provider: string;
    model?: string;
    isExact: boolean;
    method: string;
    tokenSource?: TokenSource;
}
export interface ApiUsage {
    inputTokens: number;
    outputTokens: number;
}
export interface ProxyTokenCounts {
    requestTokens: number;
    responseTokens: number;
    totalTokens: number;
    tokenSource: TokenSource;
    requestTokenSource: TokenSource;
    responseTokenSource: TokenSource;
    imageTokens: number;
    audioTokens: number;
    method?: string;
}
/** Detect LLM provider from model id string. */
export declare function detectProvider(modelId: string): TokenProvider;
/** OpenAI-style image token estimate: (width × height) / 750 per image. */
export declare function imageTokensFromDimensions(width: number, height: number): number;
/** Recursively scan payload for images and sum token estimates. */
export declare function countImageTokensInPayload(payload: unknown, seen?: WeakSet<object>): number;
export declare function estimateAudioTokens(durationSeconds: number): number;
/** Recursively scan payload for audio duration fields and sum token estimates. */
export declare function countAudioTokensInPayload(payload: unknown, seen?: WeakSet<object>): number;
/** Extract provider usage block from JSON-RPC or nested metadata. */
export declare function extractApiUsage(payload: unknown): ApiUsage | null;
/** Log when API-reported tokens diverge from estimate by more than 5%. */
export declare function logTokenDriftIfNeeded(estimated: number, actual: number, context: string): void;
export declare class TokenCounter {
    private encodings;
    count(text: string): number;
    countWithProvider(text: string, model?: string): TokenCountResult | null;
    /**
     * Count tokens for a proxied tools/call (request + response), preferring API usage.
     */
    countProxyCall(options: {
        requestText: string;
        responseText: string;
        model?: string;
        requestPayload?: unknown;
        responsePayload?: unknown;
    }): ProxyTokenCounts;
    private estimateTextTokens;
    private anthropicCountLocal;
    private anthropicCountApi;
    private googleCountApi;
    private litellmCount;
    countSimple(text: string): number;
    private tiktokenCount;
    free(): void;
}
/** Extract model id from MCP tools/call message shape. */
export declare function extractModelFromPayload(msg: unknown): string | undefined;
/** Lazy-load optional @anthropic-ai/tokenizer; returns null when unavailable. */
export declare function countAnthropicTokensSync(text: string): number | null;
//# sourceMappingURL=token-counter.d.ts.map