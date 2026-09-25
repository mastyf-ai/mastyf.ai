/**
 * Argument Sanitizer — neutralizes detected prompt injection payloads
 * in tool call arguments before they reach downstream AI agents.
 *
 * Strategies:
 *   1. Character-level neutralization (replacing control chars)
 *   2. Token-level scrubbing (removing known injection phrases)
 *   3. Structural sanitization (truncating overly long/suspicious values)
 */
import { Logger } from '../../utils/logger.js';
export class ArgumentSanitizer {
    maxStringLength = 10_000;
    safeReplacement = '[REDACTED]';
    /**
     * Sanitize arguments based on detection results.
     */
    sanitize(originalArgs, detection) {
        const sanitized = { ...originalArgs };
        const modifiedKeys = [];
        if (!detection.detected) {
            return {
                args: sanitized,
                modifiedKeys: [],
                description: 'No sanitization needed — no injection detected',
            };
        }
        for (const key of detection.suspiciousArgs) {
            const value = originalArgs[key];
            if (typeof value !== 'string')
                continue;
            let cleaned = value;
            // Apply sanitization strategies
            cleaned = this.removeControlCharacters(cleaned);
            cleaned = this.scrubInjectionPhrases(cleaned);
            cleaned = this.truncateIfNeeded(cleaned);
            if (cleaned !== value) {
                sanitized[key] = cleaned;
                modifiedKeys.push(key);
            }
            // If confidence is very high, replace entirely
            if (detection.confidence > 0.9) {
                sanitized[key] = this.safeReplacement;
                if (!modifiedKeys.includes(key)) {
                    modifiedKeys.push(key);
                }
            }
        }
        const description = modifiedKeys.length > 0
            ? `Sanitized ${modifiedKeys.length} argument(s): ${modifiedKeys.join(', ')}`
            : 'No arguments were modified';
        Logger.info(`[ArgumentSanitizer] ${description} (category: ${detection.category}, confidence: ${(detection.confidence * 100).toFixed(0)}%)`);
        return {
            args: sanitized,
            modifiedKeys,
            description,
        };
    }
    /**
     * Remove or neutralize control characters and zero-width characters.
     */
    removeControlCharacters(input) {
        return input
            // Zero-width characters
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            // Unicode direction overrides
            .replace(/[\u202A-\u202E]/g, '')
            // Null bytes
            .replace(/\0/g, '')
            // Escape control chars (keep newlines/tabs)
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }
    /**
     * Scrub known injection trigger phrases from the text.
     */
    scrubInjectionPhrases(input) {
        let result = input;
        // High-signal injection phrases to neutralize
        const phrases = [
            /ignore\s+(all\s+)?(previous|above)\s+(instructions?|prompts?)/gi,
            /you\s+are\s+now\s+(a\s+)?(different|new)\s+(AI|assistant|model)/gi,
            /forget\s+(everything|all\s+(previous|above)\s+(instructions?|context))/gi,
            /override\s+(system\s+)?(instructions?|prompts?|directives?)/gi,
            /pretend\s+(you\s+are|to\s+be)\s+(a\s+)?(different|someone)/gi,
            /from\s+now\s+on\s+you\s+(are|will\s+be)\s+(a\s+)?(malicious|evil|unrestricted)/gi,
            /do\s+not\s+follow\s+(previous|above|original)\s+(instructions?|rules?)/gi,
        ];
        for (const phrase of phrases) {
            result = result.replace(phrase, this.safeReplacement);
        }
        return result;
    }
    /**
     * Truncate excessively long string values that may hide payloads.
     */
    truncateIfNeeded(input) {
        if (input.length > this.maxStringLength) {
            const truncated = input.substring(0, this.maxStringLength);
            return truncated + `\n[...truncated ${input.length - this.maxStringLength} characters for safety]`;
        }
        return input;
    }
}
//# sourceMappingURL=argument-sanitizer.js.map