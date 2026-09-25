export interface InjectionFinding {
    severity: 'critical' | 'high' | 'medium';
    patternId: string;
    description: string;
    matchPreview: string;
}
interface InjectionPattern {
    id: string;
    severity: 'critical' | 'high' | 'medium';
    description: string;
    regex: string;
}
/** Exported for adversarial-harness parity (Python reimplementation). */
export declare const INJECTION_RULES: InjectionPattern[];
export interface ScanToolCallArgumentsOptions {
    /** When true, only critical-severity patterns (legacy semantic-guards behavior). */
    criticalOnly?: boolean;
}
/**
 * Scan all string leaves in tool call arguments with the full injection rule set.
 */
export declare function scanToolCallArguments(args: Record<string, unknown> | undefined, options?: ScanToolCallArgumentsOptions): InjectionFinding[];
export declare function detectPromptInjection(_toolName: string, responseBody: string): InjectionFinding[];
export {};
//# sourceMappingURL=prompt-injection-detector.d.ts.map