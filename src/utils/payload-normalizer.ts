/**
 * Payload Normalization Layer — sanitizes inputs before policy evaluation.
 *
 * Closes bypass class: URL-encoded, hex-encoded, unicode-homoglyph,
 * and shell-escape-obfuscated payloads that evade regex pattern matching.
 *
 * Architecture: normalize → denormalize → sanitize → evaluate
 */
import { foldHomoglyphs, normalizeConfusables } from './confusables.js';
import { foldExtendedHomoglyphs, preprocessForInjectionMatch, stripCombiningMarks } from './injection-preprocess.js';

/** Zero-width / bidi controls stripped before prompt-injection and semantic regex. */
const ZERO_WIDTH_RE = /[\u200B-\u200F\uFEFF\u00AD\u2060-\u2064\u061C\u180E\u034F\u17B4\u17B5\u202A-\u202E\u2800\uFE00-\uFE0F]/g;

export function stripZeroWidthCharacters(input: string): string {
  return input.replace(ZERO_WIDTH_RE, '');
}

export interface NormalizationResult {
  /** The fully normalized string ready for policy evaluation */
  normalized: string;
  /** Whether any normalization was applied */
  wasModified: boolean;
  /** What transformations were applied */
  transformations: string[];
  /** The original raw input */
  original: string;
}

/**
 * PayloadNormalizer applies multi-stage normalization to defeat
 * common evasion techniques targeting regex-based policy engines.
 */
export class PayloadNormalizer {
  private readonly maxDepth: number;
  private readonly maxLength: number;
  private readonly unicodeStrict: boolean;

  constructor(maxDepth = 5, maxLength = 1_000_000, unicodeStrict = true) {
    this.maxDepth = maxDepth;
    this.maxLength = maxLength;
    this.unicodeStrict = unicodeStrict;
  }

  /**
   * Full normalization pipeline for policy evaluation input.
   */
  normalize(input: string): NormalizationResult {
    const transformations: string[] = [];
    let current = input;
    let depth = 0;

    // ── Step 0: Truncate oversized inputs (memory safety) ──
    if (current.length > this.maxLength) {
      current = current.slice(0, this.maxLength);
      transformations.push('truncated');
    }

    current = stripZeroWidthCharacters(current);
    if (current !== input) {
      transformations.push('zero-width-strip');
    }

    // ── Step 1: Homoglyph fold → TR39 confusables (optional) → NFKC ──
    const homoglyphFolded = foldHomoglyphs(current);
    if (homoglyphFolded !== current) {
      transformations.push('homoglyph-fold');
      current = homoglyphFolded;
    }
    if (this.unicodeStrict) {
      const confusableNormalized = normalizeConfusables(current);
      if (confusableNormalized !== current) {
        transformations.push('confusables-tr39');
        current = confusableNormalized;
      }
    }
    const unicodeNormalized = current.normalize('NFKC');
    if (unicodeNormalized !== current) {
      transformations.push('unicode-nfkc');
      current = unicodeNormalized;
    }

    // ── Step 2: Iterative decode loop (URL, hex, HTML entities) ──
    while (depth < this.maxDepth) {
      const before = current;

      // URL decode (handles %20, %00 null bytes, %2F slashes)
      current = this.urlDecode(current);

      // Hex escape decode (\x41, \x00, \x2F)
      current = this.decodeHexEscapes(current);
      current = this.decodeRawHexStrings(current);

      // Unicode escape decode (\u0041, \U00000041)
      current = this.decodeUnicodeEscapes(current);

      // HTML entity decode (<, &#60;, &#x3C;)
      current = this.decodeHtmlEntities(current);

      // Double-backslash unwrap (\\. → .)
      current = this.unwrapDoubleEscapes(current);

      if (current === before) break;
      depth++;
    }

    if (current !== unicodeNormalized) {
      transformations.push('decode-loop');
    }

    // ── Step 3: Shell normalization ──
    const shellNormalized = this.shellNormalize(current);
    if (shellNormalized !== current) {
      transformations.push('shell-normalize');
      current = shellNormalized;
    }

    // ── Step 4: Whitespace normalization (collapse runs) ──
    const whitespaceNormalized = current.replace(/\s+/g, ' ').trim();
    if (whitespaceNormalized !== current) {
      transformations.push('whitespace');
      current = whitespaceNormalized;
    }

    return {
      normalized: current,
      wasModified: transformations.length > 0,
      transformations,
      original: input,
    };
  }

  /**
   * URL decode: %XX → character, handles malformed sequences.
   */
  private urlDecode(input: string): string {
    try {
      // Only decode percent-encoded sequences; do NOT treat + as space (form-encoding, not applicable to JSON-RPC)
      return input.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex) => {
        try { return String.fromCharCode(parseInt(hex, 16)); } catch { return _match; }
      });
    } catch {
      // Gracefully handle malformed % sequences: replace only valid ones
      return input.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex) => {
        try {
          return String.fromCharCode(parseInt(hex, 16));
        } catch {
          return _match;
        }
      });
    }
  }

  /**
   * Decode hex escapes: \x41 → 'A', \x00 → null byte detection.
   */
  private decodeHexEscapes(input: string): string {
    return input.replace(/\\x([0-9A-Fa-f]{2})/g, (_match, hex) => {
      const code = parseInt(hex, 16);
      // Preserve null byte as marker for detection
      if (code === 0) return '\0';
      return String.fromCharCode(code);
    });
  }

  /** Decode contiguous raw hex (e.g. 69676e6f7265 → ignore). */
  private decodeRawHexStrings(input: string): string {
    return input.replace(RAW_HEX_BLOB_RE, (match, hex: string) => {
      if (hex.length < 16 || hex.length % 2 !== 0) return match;
      try {
        const decoded = Buffer.from(hex, 'hex').toString('utf8');
        if (decoded.length >= 4 && /^[\x20-\x7E]+$/.test(decoded)) return decoded;
      } catch {
        // keep original
      }
      return match;
    });
  }

  /**
   * Decode unicode escapes: \u0041 → 'A', \U00000041 → 'A'.
   */
  private decodeUnicodeEscapes(input: string): string {
    return input
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_match, hex) => {
        try {
          return String.fromCharCode(parseInt(hex, 16));
        } catch {
          return _match;
        }
      })
      .replace(/\\U([0-9A-Fa-f]{8})/g, (_match, hex) => {
        try {
          const code = parseInt(hex, 16);
          if (code > 0x10ffff) return _match; // Invalid unicode
          return String.fromCodePoint(code);
        } catch {
          return _match;
        }
      });
  }

  /**
   * Decode HTML entities: < -> <, &#60; -> <, &#x3C; -> <.
   * Entity map built at runtime to avoid source-level entity decoding issues.
   */
  private static htmlEntityMap: Array<[RegExp, string]> | null = null;

  private static getHtmlEntityMap(): Array<[RegExp, string]> {
    if (PayloadNormalizer.htmlEntityMap) return PayloadNormalizer.htmlEntityMap;

    const a = String.fromCharCode(38); // ampersand char
    const pairs: Array<[string, string]> = [
      [a + 'lt;', '<'],
      [a + 'gt;', '>'],
      [a + 'amp;', a],
      [a + 'quot;', '"'],
      [a + '#39;', "'"],
      [a + 'apos;', "'"],
      [a + 'sol;', '/'],
      [a + 'bsol;', '\\'],
      [a + 'colon;', ':'],
      [a + 'semi;', ';'],
      [a + 'verbar;', '|'],
      [a + 'dollar;', '$'],
      [a + 'lpar;', '('],
      [a + 'rpar;', ')'],
      [a + 'lcub;', '{'],
      [a + 'rcub;', '}'],
      [a + 'lbrack;', '['],
      [a + 'rbrack;', ']'],
    ];

    PayloadNormalizer.htmlEntityMap = pairs.map(([entity, ch]) => {
      const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return [new RegExp(escaped, 'g'), ch];
    });

    return PayloadNormalizer.htmlEntityMap;
  }

  private decodeHtmlEntities(input: string): string {
    let result = input;
    // Named entities
    for (const [regex, ch] of PayloadNormalizer.getHtmlEntityMap()) {
      result = result.replace(regex, ch);
    }
    // Numeric decimal entities: &#60;
    result = result.replace(/&#(\d+);/g, (_match, dec) => {
      const code = parseInt(dec, 10);
      return (code > 0 && code < 65536) ? String.fromCharCode(code) : _match;
    });
    // Numeric hex entities: &#x3C;
    result = result.replace(/&#x([0-9A-Fa-f]+);/g, (_match, hex) => {
      const code = parseInt(hex, 16);
      return (code > 0 && code < 65536) ? String.fromCharCode(code) : _match;
    });
    return result;
  }

  /**
   * Unwrap double escapes: \\. → literal character.
   */
  private unwrapDoubleEscapes(input: string): string {
    return input.replace(/\\(.)/g, (_match, char) => {
      // Only unwrap if the backslash is escaping a non-special char
      if ('\\$`"\''.includes(char)) return _match;
      return char;
    });
  }

  /**
   * Shell normalize: collapse common shell obfuscation patterns.
   *
   * - $'cmd' → cmd (ANSI-C quoting)
   * - "c"m"d" → cmd (quote splitting)
   * - ''cmd'' → cmd (empty quote pairs)
   * - c\md → cmd (backslash escapes)
   */
  private shellNormalize(input: string): string {
    let result = input;

    // ANSI-C quoting: $'command' → command
    result = result.replace(/\$'([^']*)'/g, '$1');

    // Quote splitting: "a""b" → ab, 'a''b' → ab
    result = result.replace(/["']\s*["']/g, '');

    // Shell backslash escapes on non-special chars
    result = result.replace(/\\([^\\$`"'|&;><~#%{}()\[\]])/g, '$1');

    // Null byte detection (normalized → mark as NUL for policy patterns)
    result = result.replace(/\0/g, '\\0');

    return result;
  }

  /**
   * Specifically normalize a JSON string value (tool argument).
   * Handles nested JSON structures recursively.
   */
  normalizeJsonValue(value: unknown, depth = 0): unknown {
    if (depth > 10) return value; // Recursion guard

    if (typeof value === 'string') {
      return this.deobfuscateRecursive(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeJsonValue(item, depth + 1));
    }

    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.normalizeJsonValue(val, depth + 1);
      }
      return result;
    }

    return value;
  }

  /**
   * Iteratively decode layered obfuscation (base64, URL, hex, unicode, HTML)
   * until stable or maxDepth reached. Used before prompt-injection / semantic regex.
   */
  deobfuscateRecursive(input: string, maxDepth = this.maxDepth): string {
    let current = input.replace(ZERO_WIDTH_RE, ' ');
    let depth = 0;
    while (depth < maxDepth) {
      const before = current;
      current = this.urlDecode(current);
      current = this.decodeHexEscapes(current);
      current = this.decodeRawHexStrings(current);
      current = this.decodeUnicodeEscapes(current);
      current = this.decodeHtmlEntities(current);
      current = this.unwrapDoubleEscapes(current);
      current = this.decodeBase64Blobs(current);
      if (current === before) break;
      depth++;
    }
    current = foldExtendedHomoglyphs(current);
    if (this.unicodeStrict) {
      current = normalizeConfusables(current);
    }
    current = stripCombiningMarks(current);
    current = current.normalize('NFKC');
    return preprocessForInjectionMatch(current, this.unicodeStrict);
  }

  /**
   * Decode inline base64 blobs (12+ chars) when UTF-8 decodes to printable text.
   * Also decodes whole-string base64 payloads (common prompt-injection evasion).
   */
  private decodeBase64Blobs(input: string): string {
    const tryDecode = (b64: string): string | null => {
      if (b64.length < 12 || b64.length % 4 === 1) return null;
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        if (decoded.length < 4 || !/^[\x20-\x7E\u00A0-\uFFFF\s]+$/.test(decoded)) return null;
        if (
          /\\x[0-9a-f]{2}/i.test(decoded) ||
          /%[0-9a-f]{2}/i.test(decoded) ||
          /^[A-Za-z0-9+/]{12,}={0,2}$/.test(decoded.trim())
        ) {
          return decoded;
        }
        if (!/[a-zA-Z]{3,}/.test(decoded)) return null;
        return decoded;
      } catch {
        return null;
      }
    };

    const looksLikeFurtherEncoding = (s: string): boolean =>
      /\\x[0-9a-f]{2}/i.test(s) ||
      /%[0-9a-f]{2}/i.test(s) ||
      /^[A-Za-z0-9+/]{12,}={0,2}$/.test(s.trim());

    if (!/\\x[0-9a-f]{2}/i.test(input)) {
      const trimmed = input.trim();
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
        const whole = tryDecode(trimmed);
        if (whole && !looksLikeFurtherEncoding(whole)) return whole;
      }

      return input.replace(/(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{12,}={0,2})/g, (full, b64: string) => {
        const decoded = tryDecode(b64);
        if (!decoded) return full;
        return full.replace(b64, decoded);
      });
    }

    return input;
  }
}

/** Standalone recursive de-obfuscation (unicode → base64 → URL → hex → HTML). */
export function deobfuscateRecursive(input: string, maxDepth = 5, unicodeStrict = true): string {
  return getNormalizer(unicodeStrict).deobfuscateRecursive(input, maxDepth);
}

const BASE64_SHELL_DECODE_RE =
  /\b(?:curl|wget|bash|sh\s|\/bin\/sh|rm\s+-rf|eval\s|exec\s|powershell|pwsh)\b/i;

const RAW_HEX_BLOB_RE = /\b([0-9a-fA-F]{16,})\b/g;
const INLINE_BASE64_BLOB_RE = /(?:^|[^A-Za-z0-9+/])([A-Za-z0-9+/]{16,}={0,2})/g;

/**
 * Light scan: decode inline base64 blobs (capped) and flag shell/downloader text.
 * Used as belt-and-suspenders before regex policy rules.
 */
export function detectShellInBase64Blobs(input: string, maxBlobLen = 4096): boolean {
  if (!input || input.length > maxBlobLen * 4) return false;
  for (const match of input.matchAll(INLINE_BASE64_BLOB_RE)) {
    const b64 = match[1];
    if (!b64 || b64.length > maxBlobLen) continue;
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      if (decoded.length >= 4 && BASE64_SHELL_DECODE_RE.test(decoded)) {
        return true;
      }
    } catch {
      // ignore invalid base64
    }
  }
  return false;
}

/** Singleton instance for policy engine integration */
let defaultInstance: PayloadNormalizer | null = null;
let defaultUnicodeStrict = true;

export function getNormalizer(unicodeStrict = true): PayloadNormalizer {
  if (!defaultInstance || defaultUnicodeStrict !== unicodeStrict) {
    defaultInstance = new PayloadNormalizer(5, 1_000_000, unicodeStrict);
    defaultUnicodeStrict = unicodeStrict;
  }
  return defaultInstance;
}