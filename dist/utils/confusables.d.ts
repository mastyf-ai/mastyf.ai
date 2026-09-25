export declare function foldHomoglyphs(input: string): string;
interface ConfusablesData {
    single: Map<number, string>;
    /** Longest source strings first for greedy multi-codepoint replacement */
    multi: {
        source: string;
        target: string;
    }[];
}
/** Lazy singleton — loads TR39 confusables.txt once per process */
export declare function getConfusablesData(): ConfusablesData;
/** Reset cache (tests only) */
export declare function resetConfusablesCache(): void;
/**
 * TR39 confusables skeleton mapping: replace lookalike sequences with canonical forms.
 * Apply before Unicode NFKC per UTS #39 best practice.
 */
export declare function normalizeConfusables(input: string): string;
/**
 * Full Unicode normalization for policy paths: homoglyph fast path → TR39 → NFKC.
 */
export declare function normalizeUnicode(input: string, unicodeStrict?: boolean): string;
export {};
//# sourceMappingURL=confusables.d.ts.map