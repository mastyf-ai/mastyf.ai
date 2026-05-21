/**
 * Unicode TR39 confusables normalization (UTS #39 skeleton mapping).
 * Complements NFKC and fast Cyrillic homoglyph folding for policy regex matching.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Fast path: common Cyrillic/Greek homoglyphs not always in confusables pass order */
const HOMOGLYPH_MAP: Record<number, string> = {
  0x0430: 'a', // а
  0x0435: 'e', // е
  0x043e: 'o', // о
  0x0438: 'i', // и
  0x0433: 'g', // г
  0x043d: 'n', // н
  0x0442: 't', // т
  0x0440: 'p', // р
  0x0441: 'c', // с
  0x0443: 'y', // у
  0x0445: 'x', // х
  0x0456: 'i', // і
  0x03bf: 'o', // ο Greek omicron
  0x03c1: 'p', // ρ
  0x03b1: 'a', // α
  0x03b5: 'e', // ε
  0x03b9: 'i', // ι
  0x03c3: 's', // σ
};

export function foldHomoglyphs(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    out += HOMOGLYPH_MAP[code] ?? ch;
  }
  return out;
}

interface ConfusablesData {
  single: Map<number, string>;
  /** Longest source strings first for greedy multi-codepoint replacement */
  multi: { source: string; target: string }[];
}

let cachedData: ConfusablesData | null = null;
let loadAttempted = false;

function hexSequenceToString(hex: string): string {
  const parts = hex.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.map((h) => String.fromCodePoint(parseInt(h, 16))).join('');
}

function resolveConfusablesPath(): string {
  const candidates = [
    join(__dirname, '..', 'assets', 'confusables.txt'), // dist/utils → assets/
    join(__dirname, '..', '..', 'assets', 'confusables.txt'), // src/utils → assets/
    join(process.cwd(), 'assets', 'confusables.txt'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]!;
}

/** Inbound security: fold non-ASCII lookalikes to skeleton; never expand ASCII (e.g. m→rn). */
function shouldApplySource(source: string): boolean {
  const cp = source.codePointAt(0)!;
  if (source.length > 1) return true;
  // Fullwidth / halfwidth Latin forms
  if (cp >= 0xff00 && cp <= 0xffef) return true;
  // Skip basic ASCII — TR39 skeleton expansions are for comparison, not inbound regex
  return cp > 0x7f;
}

function parseConfusablesFile(content: string): ConfusablesData {
  const single = new Map<number, string>();
  const multi: { source: string; target: string }[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const commentIdx = trimmed.indexOf('#');
    const dataPart = commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed;
    const fields = dataPart.split(';').map((f) => f.trim());
    if (fields.length < 2) continue;

    const sourceHex = fields[0];
    const targetHex = fields[1];
    if (!sourceHex || !targetHex) continue;

    const source = hexSequenceToString(sourceHex);
    const target = hexSequenceToString(targetHex);
    if (!source || !target) continue;

    if (!shouldApplySource(source)) continue;

    if (sourceHex.includes(' ')) {
      multi.push({ source, target });
    } else {
      const cp = source.codePointAt(0)!;
      single.set(cp, target);
    }
  }

  multi.sort((a, b) => b.source.length - a.source.length);
  return { single, multi };
}

/** Lazy singleton — loads TR39 confusables.txt once per process */
export function getConfusablesData(): ConfusablesData {
  if (cachedData) return cachedData;
  if (loadAttempted) {
    return cachedData ?? { single: new Map(), multi: [] };
  }
  loadAttempted = true;

  const path = resolveConfusablesPath();
  if (!existsSync(path)) {
    cachedData = { single: new Map(), multi: [] };
    return cachedData;
  }

  try {
    const content = readFileSync(path, 'utf8');
    cachedData = parseConfusablesFile(content);
  } catch {
    cachedData = { single: new Map(), multi: [] };
  }
  return cachedData!;
}

/** Reset cache (tests only) */
export function resetConfusablesCache(): void {
  cachedData = null;
  loadAttempted = false;
}

/**
 * TR39 confusables skeleton mapping: replace lookalike sequences with canonical forms.
 * Apply before Unicode NFKC per UTS #39 best practice.
 */
export function normalizeConfusables(input: string): string {
  const { single, multi } = getConfusablesData();
  if (single.size === 0 && multi.length === 0) return input;

  let result = '';
  let i = 0;

  while (i < input.length) {
    let matched = false;
    for (const { source, target } of multi) {
      if (input.startsWith(source, i)) {
        result += target;
        i += source.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const cp = input.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const replacement = single.get(cp);
    result += replacement ?? ch;
    i += ch.length;
  }

  return result;
}

/**
 * Full Unicode normalization for policy paths: homoglyph fast path → TR39 → NFKC.
 */
export function normalizeUnicode(input: string, unicodeStrict = true): string {
  let current = foldHomoglyphs(input);
  if (unicodeStrict) {
    current = normalizeConfusables(current);
  }
  return current.normalize('NFKC');
}
