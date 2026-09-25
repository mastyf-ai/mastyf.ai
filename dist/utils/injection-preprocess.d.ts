export declare function rot13(text: string): string;
export declare function deleetspeak(text: string): string;
export declare function stripCombiningMarks(text: string): string;
export declare function foldExtendedHomoglyphs(input: string): string;
/** Strip SQL and HTML comments so spaced-token injection cannot hide inside comment syntax. */
export declare function stripInjectionComments(text: string): string;
export declare function collapseControlWhitespace(text: string): string;
/**
 * Full normalization pipeline before regex / injection rules run.
 */
export declare function preprocessForInjectionMatch(input: string, unicodeStrict?: boolean): string;
/** Variants for injection regex (leetspeak always; ROT13 only when requested). */
export declare function injectionMatchVariants(preprocessed: string, options?: {
    includeRot13?: boolean;
}): string[];
export declare function shouldTryRot13Variant(patternId: string): boolean;
//# sourceMappingURL=injection-preprocess.d.ts.map