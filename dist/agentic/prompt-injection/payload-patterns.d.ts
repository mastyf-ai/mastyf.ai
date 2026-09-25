/**
 * Curated prompt injection payload patterns.
 *
 * These regex patterns detect known injection techniques in tool call arguments.
 * Categories follow the OWASP LLM Top 10 classification for prompt injection.
 *
 * Patterns are compiled once at import time for performance.
 */
export interface InjectionPattern {
    /** Human-readable category */
    category: string;
    /** What this pattern detects */
    description: string;
    /** Confidence 0-1 for heuristic matches */
    confidence: number;
    /** Compiled regex patterns */
    patterns: RegExp[];
}
export declare const PROMPT_INJECTION_PATTERNS: InjectionPattern[];
//# sourceMappingURL=payload-patterns.d.ts.map