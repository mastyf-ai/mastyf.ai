export interface PickMastyfAiConfigOptions {
    /** Explicit --config path */
    configPath?: string;
    /** Search roots (default: cwd) */
    searchRoots?: string[];
    /**
     * When true (default), also search the onboard configsDir before searchRoots.
     * Tests / isolated callers should set false when passing explicit searchRoots.
     */
    includeOnboard?: boolean;
}
/**
 * Pick first valid single-stdio-server mastyf-ai config.
 * Priority: explicit path → onboard configsDir (optional) → mastyf-ai-configs under search roots.
 */
export declare function pickMastyfAiConfig(opts?: PickMastyfAiConfigOptions): string | null;
//# sourceMappingURL=pick-mastyf-ai-config.d.ts.map