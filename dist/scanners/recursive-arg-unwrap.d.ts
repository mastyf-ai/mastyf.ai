/**
 * Recursive Argument Unwrapper
 *
 * Flattens arbitrarily nested JSON argument objects/arrays (up to MAX_DEPTH)
 * and extracts nested serialized strings, preventing mcp_hidden_fields evasion.
 */
export interface UnwrapResult {
    flattenedArgs: Record<string, unknown>;
    leafValues: string[];
    depth: number;
    hiddenFieldsDetected: string[];
}
/**
 * Recursively inspects and unwraps arguments.
 */
export declare function recursiveUnwrap(args: Record<string, unknown> | null | undefined, depth?: number, path?: string): UnwrapResult;
//# sourceMappingURL=recursive-arg-unwrap.d.ts.map