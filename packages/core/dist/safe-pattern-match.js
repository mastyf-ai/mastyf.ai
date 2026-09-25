/** Capped regex matching for attacker-controlled argument strings. */
export function argumentScanMaxChars() {
    const n = parseInt(process.env["MASTYF_AI_ARG_SCAN_MAX_CHARS"] || "8192", 10);
    return Number.isFinite(n) && n > 0 ? n : 8192;
}
export function capArgumentInput(value, maxChars = argumentScanMaxChars()) {
    if (value.length <= maxChars)
        return value;
    return value.slice(0, maxChars);
}
/** Run pattern.test on length-capped input; resets lastIndex for global regexes. */
export function testPattern(pattern, value, maxChars) {
    const slice = capArgumentInput(value, maxChars);
    if (pattern.global)
        pattern.lastIndex = 0;
    return pattern.test(slice);
}
/** Run pattern.exec on length-capped input. */
export function execPattern(pattern, value, maxChars) {
    const slice = capArgumentInput(value, maxChars);
    if (pattern.global)
        pattern.lastIndex = 0;
    return pattern.exec(slice);
}
//# sourceMappingURL=safe-pattern-match.js.map