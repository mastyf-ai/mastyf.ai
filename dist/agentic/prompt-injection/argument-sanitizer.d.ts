/**
 * Argument Sanitizer — neutralizes detected prompt injection payloads
 * in tool call arguments before they reach downstream AI agents.
 *
 * Strategies:
 *   1. Character-level neutralization (replacing control chars)
 *   2. Token-level scrubbing (removing known injection phrases)
 *   3. Structural sanitization (truncating overly long/suspicious values)
 */
import type { InjectionDetectionResult } from './detector.js';
export interface SanitizationResult {
    /** The sanitized arguments */
    args: Record<string, unknown>;
    /** Keys that were modified */
    modifiedKeys: string[];
    /** Description of what was done */
    description: string;
}
export declare class ArgumentSanitizer {
    private readonly maxStringLength;
    private readonly safeReplacement;
    /**
     * Sanitize arguments based on detection results.
     */
    sanitize(originalArgs: Record<string, unknown>, detection: InjectionDetectionResult): SanitizationResult;
    /**
     * Remove or neutralize control characters and zero-width characters.
     */
    private removeControlCharacters;
    /**
     * Scrub known injection trigger phrases from the text.
     */
    private scrubInjectionPhrases;
    /**
     * Truncate excessively long string values that may hide payloads.
     */
    private truncateIfNeeded;
}
//# sourceMappingURL=argument-sanitizer.d.ts.map