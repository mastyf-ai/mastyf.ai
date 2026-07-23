/**
 * Unicode TR39 confusables for offline @mastyf_ai/core regex scans.
 * Mirrors src/utils/confusables.ts; resolves repo-root assets/confusables.txt.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOMOGLYPH_MAP: Record<number, string> = {
  0x0430: "a",
  0x0435: "e",
  0x043e: "o",
  0x0438: "i",
  0x0433: "g",
  0x043d: "n",
  0x0442: "t",
  0x0440: "p",
  0x0441: "c",
  0x0443: "y",
  0x0445: "x",
  0x0456: "i",
  0x03bf: "o",
  0x03c1: "p",
  0x03b1: "a",
  0x03b5: "e",
  0x03b9: "i",
  0x03c3: "s",
};

export function foldHomoglyphs(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    out += HOMOGLYPH_MAP[code] ?? ch;
  }
  return out;
}

interface ConfusablesData {
  single: Map<number, string>;
  multi: { source: string; target: string }[];
}

let cachedData: ConfusablesData | null = null;
let loadAttempted = false;

function hexSequenceToString(hex: string): string {
  const parts = hex.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.map((h) => String.fromCodePoint(parseInt(h, 16))).join("");
}

function resolveConfusablesPath(): string {
  const candidates = [
    join(__dirname, "..", "..", "..", "assets", "confusables.txt"),
    join(__dirname, "..", "assets", "confusables.txt"),
    join(process.cwd(), "assets", "confusables.txt"),
    join(process.cwd(), "..", "..", "assets", "confusables.txt"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]!;
}

function shouldApplySource(source: string): boolean {
  const cp = source.codePointAt(0)!;
  if (source.length > 1) return true;
  if (cp >= 0xff00 && cp <= 0xffef) return true;
  return cp > 0x7f;
}

function parseConfusablesFile(content: string): ConfusablesData {
  const single = new Map<number, string>();
  const multi: { source: string; target: string }[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const commentIdx = trimmed.indexOf("#");
    const dataPart = commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed;
    const fields = dataPart.split(";").map((f) => f.trim());
    if (fields.length < 2) continue;

    const sourceHex = fields[0];
    const targetHex = fields[1];
    if (!sourceHex || !targetHex) continue;

    const source = hexSequenceToString(sourceHex);
    const target = hexSequenceToString(targetHex);
    if (!source || !target) continue;
    if (!shouldApplySource(source)) continue;

    if (sourceHex.includes(" ")) {
      multi.push({ source, target });
    } else {
      const cp = source.codePointAt(0)!;
      single.set(cp, target);
    }
  }

  multi.sort((a, b) => b.source.length - a.source.length);
  return { single, multi };
}

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
    cachedData = parseConfusablesFile(readFileSync(path, "utf8"));
  } catch {
    cachedData = { single: new Map(), multi: [] };
  }
  return cachedData!;
}

export function resetConfusablesCache(): void {
  cachedData = null;
  loadAttempted = false;
}

export function normalizeConfusables(input: string): string {
  const { single, multi } = getConfusablesData();
  if (single.size === 0 && multi.length === 0) return input;

  let result = "";
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
    result += single.get(cp) ?? ch;
    i += ch.length;
  }

  return result;
}

type UnicodeNormalizeMode = "full" | "light";

let unicodeOpsWindowStart = Date.now();
let unicodeOpsCount = 0;

function unicodeMaxChars(): number {
  const n = parseInt(process.env["MASTYF_AI_UNICODE_MAX_CHARS"] || "16384", 10);
  return Number.isFinite(n) && n > 0 ? n : 16384;
}

function unicodeMaxOpsPerMinute(): number {
  const n = parseInt(process.env["MASTYF_AI_UNICODE_MAX_OPS_PER_MINUTE"] || "2000", 10);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

function resolveUnicodeNormalizeMode(input: string, unicodeStrict: boolean): UnicodeNormalizeMode {
  if (!unicodeStrict) return "light";
  if (input.length > unicodeMaxChars()) return "light";

  const now = Date.now();
  if (now - unicodeOpsWindowStart >= 60_000) {
    unicodeOpsWindowStart = now;
    unicodeOpsCount = 0;
  }
  unicodeOpsCount += 1;
  if (unicodeOpsCount > unicodeMaxOpsPerMinute()) return "light";
  return "full";
}

/** @internal */
export function resetUnicodeBudgetForTests(): void {
  unicodeOpsWindowStart = Date.now();
  unicodeOpsCount = 0;
}

/** Homoglyph fold → TR39 confusables → NFKC (offline regex pre-pass). */
export function normalizeUnicode(input: string, unicodeStrict = true): string {
  const mode = resolveUnicodeNormalizeMode(input, unicodeStrict);
  let current = foldHomoglyphs(input);
  if (unicodeStrict && mode === "full") {
    current = normalizeConfusables(current);
  }
  return current.normalize("NFKC");
}

/** True when TR39/homoglyph folding would change matching surface. */
export function hasConfusableDelta(raw: string, unicodeStrict = true): boolean {
  if (!unicodeStrict) return false;
  return normalizeUnicode(raw, true) !== raw.normalize("NFKC");
}
