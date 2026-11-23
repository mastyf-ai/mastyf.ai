/**
 * Estimates tokens from the argument payload alone.
 *
 * Three independent estimates are combined because each misses a different
 * evasion: byte length under-counts non-ASCII, character count under-counts
 * dense ASCII, and both under-count a single stuffed field.
 */
export declare function estimateArgumentTokens(args: unknown): number;
//# sourceMappingURL=estimate-argument-tokens.d.ts.map