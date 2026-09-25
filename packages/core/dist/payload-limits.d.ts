/** Max serialized tool-call arguments bytes for core scanner (aligns with proxy payload guard). */
export declare function getMaxArgumentBytes(): number;
/** Per-field string byte cap for argument scanner leaves (M-010). */
export declare function getMaxArgumentFieldBytes(): number;
export declare function serializedArgumentBytes(args: Record<string, unknown>): number;
//# sourceMappingURL=payload-limits.d.ts.map