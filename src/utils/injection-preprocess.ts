/**
 * Text preprocessing for prompt-injection and semantic regex matching.
 * Closes unicode, boundary, ROT13, leetspeak, ANSI, and emoji evasion gaps.
 */
import { foldHomoglyphs, normalizeConfusables } from './confusables.js';

/** Zero-width / bidi — replaced with ASCII space so word boundaries survive. */
const INVISIBLE_TO_SPACE_RE =
  /[\u200B-\u200F\uFEFF\u00AD\u2060-\u2064\u061C\u180E\u034F\u17B4\u17B5\u202A-\u202E\u2800\uFE00-\uFE0F]/g;

/** Braille pattern blank and other unicode space separators. */
const UNICODE_SPACE_RE =
  /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u3164]/g;

/** ANSI CSI and related escape sequences. */
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07/g;

/** Emoji blocks used as instruction padding. */
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}]/gu;

const LEET_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's',
};

/** Fast Cyrillic/Greek + math alphanumeric (U+1D400–U+1D7FF subset). */
const EXTRA_HOMOGLYPHS: Record<number, string> = {
  0x0438: 'i', // и
  0x0433: 'r', // г (rough)
  0x043d: 'n', // н
  0x0441: 'c', // с
  0x0442: 't', // т
  0x0440: 'p', // р
  0x0432: 'b', // в
  0x043b: 'l', // л
  0x043c: 'm', // м
  0x0434: 'd', // д
  0x0455: 's', // ѕ
  0x04cf: 'l', // ӏ
};

export function rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
  });
}

export function deleetspeak(text: string): string {
  return text.replace(/[013457@$]/g, (ch) => LEET_MAP[ch] ?? ch);
}

export function stripCombiningMarks(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

export function foldExtendedHomoglyphs(input: string): string {
  let out = foldHomoglyphs(input);
  let result = '';
  for (const ch of out) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x1d400 && code <= 0x1d7ff) {
      const offset = code - 0x1d400;
      const latin = offset % 26;
      const isUpper = Math.floor(offset / 26) % 2 === 1;
      result += String.fromCharCode((isUpper ? 65 : 97) + latin);
      continue;
    }
    result += EXTRA_HOMOGLYPHS[code] ?? ch;
  }
  return result;
}

/**
 * Collapse control chars and exotic whitespace to a single ASCII space.
 */
export function collapseControlWhitespace(text: string): string {
  return text
    .replace(INVISIBLE_TO_SPACE_RE, ' ')
    .replace(UNICODE_SPACE_RE, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(/[\t\r\n\f\v]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Full normalization pipeline before regex / injection rules run.
 */
export function preprocessForInjectionMatch(
  input: string,
  unicodeStrict = true,
): string {
  let current = input;
  current = current.replace(INVISIBLE_TO_SPACE_RE, ' ');
  current = foldExtendedHomoglyphs(current);
  if (unicodeStrict) {
    current = normalizeConfusables(current);
  }
  current = stripCombiningMarks(current);
  current = current.normalize('NFKC');
  current = current.replace(ANSI_ESCAPE_RE, '');
  current = EMOJI_RE.test(current) ? current.replace(EMOJI_RE, ' ') : current;
  current = collapseControlWhitespace(current);
  return current;
}

/** Variants for injection regex (leetspeak always; ROT13 only when requested). */
export function injectionMatchVariants(
  preprocessed: string,
  options?: { includeRot13?: boolean },
): string[] {
  const variants = new Set<string>();
  variants.add(preprocessed);
  variants.add(deleetspeak(preprocessed));
  if (options?.includeRot13) {
    const r13 = rot13(preprocessed);
    variants.add(r13);
    variants.add(deleetspeak(r13));
  }
  return [...variants];
}

const ROT13_VARIANT_PATTERN_IDS = new Set([
  'rot13-obfuscation',
  'ignore-instructions',
  'leetspeak-injection',
]);

export function shouldTryRot13Variant(patternId: string): boolean {
  return ROT13_VARIANT_PATTERN_IDS.has(patternId);
}
