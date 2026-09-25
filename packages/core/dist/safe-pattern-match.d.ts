/** Capped regex matching for attacker-controlled argument strings. */
export declare function argumentScanMaxChars(): number;
export declare function capArgumentInput(value: string, maxChars?: number): string;
/** Run pattern.test on length-capped input; resets lastIndex for global regexes. */
export declare function testPattern(pattern: RegExp, value: string, maxChars?: number): boolean;
/** Run pattern.exec on length-capped input. */
export declare function execPattern(pattern: RegExp, value: string, maxChars?: number): RegExpExecArray | null;
//# sourceMappingURL=safe-pattern-match.d.ts.map