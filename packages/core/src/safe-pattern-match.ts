/** Capped regex matching for attacker-controlled argument strings. */

export function argumentScanMaxChars(): number {
  const n = parseInt(process.env["MASTYF_AI_ARG_SCAN_MAX_CHARS"] || "8192", 10);
  return Number.isFinite(n) && n > 0 ? n : 8192;
}

export function capArgumentInput(value: string, maxChars = argumentScanMaxChars()): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars);
}

/** Run pattern.test on length-capped input; resets lastIndex for global regexes. */
export function testPattern(pattern: RegExp, value: string, maxChars?: number): boolean {
  const slice = capArgumentInput(value, maxChars);
  if (pattern.global) pattern.lastIndex = 0;
  return pattern.test(slice);
}

/** Run pattern.exec on length-capped input. */
export function execPattern(
  pattern: RegExp,
  value: string,
  maxChars?: number,
): RegExpExecArray | null {
  const slice = capArgumentInput(value, maxChars);
  if (pattern.global) pattern.lastIndex = 0;
  return pattern.exec(slice);
}
