/** Ported from src/scanners/prompt-injection-detector.ts INJECTION_RULES — keep in sync. */
export type ArgumentInjectionRuleDef = {
    id: string;
    severity: 'critical' | 'high' | 'medium';
    description: string;
    regex: string;
};
export declare const ARGUMENT_INJECTION_RULES: ArgumentInjectionRuleDef[];
//# sourceMappingURL=argument-injection-rules.d.ts.map