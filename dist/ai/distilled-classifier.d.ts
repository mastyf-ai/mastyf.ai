/**
 * Distilled Neural Security Classifier (Tier 1.5 Fast Gate)
 *
 * Runs specialized sub-second inference using the Soup-distilled 0.6B model
 * (e.g. mastyf-guard:0.6b or Qwen2.5-0.6B-Instruct).
 *
 * Employs category-routed compact prompts to achieve ~80ms p95 latency.
 */
export interface ClassificationInput {
    serverName: string;
    toolName: string;
    arguments: Record<string, unknown>;
    categoryHint?: string;
    difcContext?: {
        tainted?: boolean;
        dataOrigins?: string[];
        secrecyTags?: string[];
    };
}
export interface ClassificationOutput {
    suspicious: boolean;
    confidence: number;
    category: string;
    latencyMs: number;
    model: string;
    source?: 'distilled' | 'fallback';
    verdict?: {
        suspicious: boolean;
        confidence: number;
        category: string;
        categories?: string[];
        reasoning?: string;
    };
}
export declare function isDistilledEnabled(): boolean;
export declare function classifyDistilled(inputOrServer: ClassificationInput | string, toolName?: string, argsText?: string): Promise<ClassificationOutput>;
export declare function shouldBlockFromDistilled(outputOrVerdict: ClassificationOutput | {
    suspicious?: boolean;
    confidence?: number;
}, threshold?: number): boolean | null;
export declare class DistilledClassifier {
    private readonly model;
    private readonly ollamaUrl;
    private readonly timeoutMs;
    constructor(options?: {
        model?: string;
        ollamaUrl?: string;
        timeoutMs?: number;
    });
    classify(input: ClassificationInput): Promise<ClassificationOutput>;
    private fallbackVerdict;
}
export declare const globalDistilledClassifier: DistilledClassifier;
//# sourceMappingURL=distilled-classifier.d.ts.map