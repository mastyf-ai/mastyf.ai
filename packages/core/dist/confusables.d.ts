export declare function foldHomoglyphs(input: string): string;
interface ConfusablesData {
    single: Map<number, string>;
    multi: {
        source: string;
        target: string;
    }[];
}
export declare function getConfusablesData(): ConfusablesData;
export declare function resetConfusablesCache(): void;
export declare function normalizeConfusables(input: string): string;
/** @internal */
export declare function resetUnicodeBudgetForTests(): void;
/** Homoglyph fold → TR39 confusables → NFKC (offline regex pre-pass). */
export declare function normalizeUnicode(input: string, unicodeStrict?: boolean): string;
/** True when TR39/homoglyph folding would change matching surface. */
export declare function hasConfusableDelta(raw: string, unicodeStrict?: boolean): boolean;
export {};
//# sourceMappingURL=confusables.d.ts.map