interface SuggestedRule {
    type: 'whitelist-path' | 'whitelist-domain' | 'whitelist-tool';
    value: string;
    frequency: number;
    recommendation: string;
}
export declare class LearningMode {
    private patterns;
    recordAllowedCall(toolName: string, args: Record<string, unknown>): void;
    getSuggestions(): SuggestedRule[];
    reset(): void;
}
export declare const learningMode: LearningMode;
export {};
//# sourceMappingURL=learning-mode.d.ts.map