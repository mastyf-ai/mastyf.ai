/**
 * Effect-gating for novel/runtime findings.
 * Soft denials (Access denied, isError) are not exploit success.
 */
export type ExploitEffectKind = 'crash' | 'secret_or_injection' | 'sensitive_content' | 'none' | 'soft_deny';
export declare function stringifyResult(result: unknown): string;
/** MCP tool result marked as error (isError / is_error). */
export declare function resultLooksLikeMcpError(result: unknown): boolean;
export declare function isSoftDenyText(text: string): boolean;
/** Response is mostly an echo of the request args (common benign FP). */
export declare function isArgsEchoOnly(args: Record<string, unknown>, responseText: string): boolean;
export declare function classifyExploitEffect(opts: {
    args?: Record<string, unknown>;
    responseText?: string;
    result?: unknown;
    crashed?: boolean;
    upstreamError?: string;
}): {
    kind: ExploitEffectKind;
    reason: string;
};
export declare function hasProvenExploitEffect(opts: {
    args?: Record<string, unknown>;
    responseText?: string;
    result?: unknown;
    crashed?: boolean;
    upstreamError?: string;
}): boolean;
export declare function isMaliciousArgs(args: Record<string, unknown>): boolean;
/** Evidence markers used by validate / NoiseRejecter. */
export declare const EXPLOIT_EFFECT_RULE = "exploit-effect";
export declare const EXPLOIT_EFFECT_DECISION = "allow-exploit";
//# sourceMappingURL=effect-classifier.d.ts.map