/**
 * Prompt-injection detection for runtime tool argument strings.
 * Keep in sync with `src/scanners/prompt-injection-detector.ts INJECTION_RULES` —
 * corpus test enforces recall.
 */
import type { Issue } from "./types.js";
export type CompiledArgumentInjectionRule = {
    id: string;
    severity: "critical" | "high" | "medium";
    description: string;
    pattern: RegExp;
    learned?: boolean;
};
export declare function reloadArgumentInjectionRules(): void;
export declare function getArgumentInjectionRules(): CompiledArgumentInjectionRule[];
/** Scan a single argument string leaf for prompt-injection patterns. */
export declare function scanArgumentPromptInjection(text: string): Issue[];
/** Exported for regex safety audit tests. */
export declare function getArgumentPromptInjectionPatterns(): RegExp[];
/** Quick predicate used by tests and smoke checks. */
export declare function matchesPromptInjection(text: string): boolean;
//# sourceMappingURL=argument-prompt-injection.d.ts.map