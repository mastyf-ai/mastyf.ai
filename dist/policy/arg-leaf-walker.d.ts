/**
 * Recursively walk all string leaves in nested tool call arguments.
 * Shared by prompt-injection, SQL/SSRF/path/base64 guards.
 */
export interface StringLeaf {
    path: string;
    value: string;
}
export declare function walkStringLeaves(obj: unknown, prefix?: string): StringLeaf[];
/** Collect decoded string values from all argument leaves. */
export declare function collectStringLeafValues(obj: unknown): string[];
//# sourceMappingURL=arg-leaf-walker.d.ts.map