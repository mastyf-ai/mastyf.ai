/**
 * Pulls comparable values out of tool results and arguments: the things an injected instruction
 * has to smuggle into a later call (a recipient, a URL, an account, a path, a sentence).
 * Runs on the request path over attacker-controlled text, so everything here is capped, and every repeat
 * in a regex that can restart at each position has a limit: unbounded ones take quadratic time.
 */
import { isFreeTextField } from './origins.js';

export type ValueKind = 'email' | 'url' | 'domain' | 'ip' | 'id' | 'path' | 'phrase' | 'short';

export interface ExtractedValue {
  kind: ValueKind;
  norm: string;
}

export interface ResultField {
  path: string;
  text: string;
  /** Field-shaped, but in text someone wrote, so it proves nothing about who wrote it. */
  loose?: boolean;
}

export interface FlattenedResult {
  fields: ResultField[];
  /** Part of the result was not read, so a value may be missing from `fields`. */
  truncated: boolean;
}

const MAX_TOTAL_CHARS = 2 * 1024 * 1024;
const MAX_FIELDS = 5000;
const MAX_DEPTH = 12;
const MAX_TOKEN_CHARS = 2048;
const MAX_LONG_TOKEN_CHARS = 256 * 1024;
const TOKEN_OVERLAP = 256;
const MAX_PHRASES_PER_TEXT = 200;
const PHRASE_WORDS = 6;
const MIN_ID_CHARS = 6;
const MIN_NUMERIC_ID_CHARS = 7;
const MIN_ENCODED_CHARS = 16;
const MIN_GROUPED_DIGITS = 9;
const MAX_FIELD_WORDS = 4;
const MAX_VALUE_WORDS = 8;
const MAX_LIST_ITEM_WORDS = 3;
const MIN_SPELLED_CHARS = 7;
const MAX_SHORT_CHARS = 64;

const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,8}/gi;
const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]},]+/gi;
// `www.` marks a host on any ending. Without it, an ending has to be a known one, or `notes.txt` and
// `e.g` would count. Matching still needs the same value on both sides, so a longer list costs little.
const DOMAIN =
  /\b(?:www\.(?:[a-z0-9-]{1,63}\.){1,8}[a-z]{2,24}|(?:[a-z0-9-]{1,63}\.){1,8}(?:com|net|org|io|ai|co|dev|app|xyz|info|biz|example|test|site|online|top|ru|cn|uk|de|tk|ml|ga|cf|gq|cc|me|us|in|fr|es|it|nl|br|jp|pw|ly|gl|gg|to|tv|sh|link|click|live|shop|store|tech|cloud|pro|club|vip|work|lol|icu|win|sbi|zip|mov))\b/gi;
const IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PATH = /(?:~|\.{1,2})?\/[\w.-]{1,255}(?:\/[\w.-]{1,255}){1,32}|[a-z]:\\[\w.-]{1,255}(?:\\[\w.-]{1,255}){0,32}/gi;
const ID = /[a-z0-9][a-z0-9_-]{5,}/gi;
const WORD = /[\p{L}\p{N}]+/gu;
const BASE64 = /^[a-z0-9+/_-]+={0,2}$/i;
const HEX = /^(?:0x)?[0-9a-f]+$/i;
// Separators inside a token never end a value there: `<a@b.co>`, `a@b.co,c@d.co`, `key="a@b.co"`.
const TOKEN_SPLIT = /[\s,;|<>"'`()[\]{}]+/;
// Account and phone numbers are written in groups: `US13 3000 0001`, `+1 (555) 010-9999`.
const GROUPED =
  /\+?\(?(?=[a-z]{0,4}\d)[a-z0-9]{1,8}\)?(?:[ .-]{1,2}\(?\d[a-z0-9]{0,7}\)?){2,12}/gi;
// A date or timestamp on its own says nothing about where an action lands, and its digits would group
// like an account number. One inside a longer token, such as `inv-2024-04-25-77`, is part of that id.
const DATE_TIME =
  /(?<![a-z0-9_-])\d{4}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])(?:[t ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?z?)?(?![a-z0-9_-])/gi;
// `U S 1 3 3 0`, or `e v i l at-sign a c m e dot c o m`: one character at a time, for the agent to join.
const SPELLED_NAMES = 'at-sign|at|dot|dash|hyphen|underscore|colon|slash|plus';
const MAX_SPELLED_CHARS = 64;
const SPELLED = new RegExp(`\\b(?:(?:[a-z0-9]|${SPELLED_NAMES})[\\s,]{1,3}){${MIN_SPELLED_CHARS - 1},${MAX_SPELLED_CHARS}}(?:[a-z0-9]|${SPELLED_NAMES})\\b`, 'gi');
const SPELLED_CHARS: Record<string, string> = {
  'at-sign': '@', at: '@', dot: '.', dash: '-', hyphen: '-', underscore: '_', colon: ':', slash: '/', plus: '+',
};
const DEFANGED_AT = /\s{0,4}[[({]\s{0,4}at\s{0,4}[\])}]\s{0,4}/gi;
const DEFANGED_DOT = /\s{0,4}[[({]\s{0,4}(?:dot|\.)\s{0,4}[\])}]\s{0,4}/gi;
const SPELLED_EMAIL = /\b([\w.+-]{1,64})\s{1,4}at\s{1,4}([\w-]{1,64})\s{1,4}dot\s{1,4}([a-z]{2,24})\b/gi;

// Latin look-alikes in other scripts. Enough to undo the common substitutions, not a full table.
const CONFUSABLES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', ѕ: 's', і: 'i', ј: 'j', һ: 'h',
  ԁ: 'd', ɡ: 'g', ո: 'n', ս: 'u', ν: 'v', ο: 'o', ρ: 'p', α: 'a', ε: 'e', ι: 'i', κ: 'k', τ: 't', υ: 'u', χ: 'x', η: 'n',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g');

/** Undoes what makes two copies of a value differ to a comparison but not to a reader. */
export function canonicalText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .replace(CONFUSABLE_RE, (ch) => CONFUSABLES[ch] ?? ch);
}

function trimTrailing(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1]!)) end--;
  return value.slice(0, end);
}

function trimEnd(value: string): string {
  return trimTrailing(value, `.,;:!?'"`);
}

function canonicalHost(host: string): string {
  const bare = host.replace(/\.+$/, '');
  return bare.startsWith('www.') ? bare.slice(4) : bare;
}

function looksLikeId(token: string): boolean {
  if (token.length < MIN_ID_CHARS) return false;
  if (/^\d+$/.test(token)) return token.length >= MIN_NUMERIC_ID_CHARS;
  return /\d/.test(token) && /[a-z]/i.test(token);
}

function printable(text: string): boolean {
  if (!text) return false;
  let ok = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if ((code >= 32 && code < 127) || code === 10 || code === 13 || code === 9) ok++;
  }
  return ok / text.length > 0.9;
}

function decodedForms(token: string): string[] {
  const out: string[] = [];
  if (/%[0-9a-f]{2}/i.test(token)) {
    try {
      out.push(decodeURIComponent(token));
    } catch {
      // not valid percent-encoding
    }
  }
  if (token.length >= MIN_ENCODED_CHARS) {
    if (HEX.test(token) && token.replace(/^0x/i, '').length % 2 === 0) {
      const text = Buffer.from(token.replace(/^0x/i, ''), 'hex').toString('utf8');
      if (printable(text)) out.push(text);
    } else if (BASE64.test(token)) {
      const text = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      if (printable(text)) out.push(text);
    }
  }
  return out;
}

function fromToken(token: string, raw: string, add: (kind: ValueKind, norm: string) => void, depth: number): void {
  let rest = token.replace(DATE_TIME, ' ');
  rest = rest.replace(URL_RE, (found) => {
    try {
      const url = new URL(trimEnd(found));
      const host = canonicalHost(url.hostname);
      add('url', `${host}${trimTrailing(url.pathname, '/')}${url.search}`);
      add('domain', host);
    } catch {
      add('url', trimEnd(found));
    }
    return ' ';
  });
  if (rest.includes('@')) {
    rest = rest.replace(EMAIL, (found) => {
      const email = trimEnd(found);
      add('email', email);
      add('email', email.replace(/\+[^@]*@/, '@')); // evil+x@ reaches the same mailbox as evil@
      return ' ';
    });
  }
  rest = rest.replace(IP, (found) => {
    add('ip', found);
    return ' ';
  });
  rest = rest.replace(PATH, (found) => {
    add('path', trimEnd(found));
    return ' ';
  });
  rest = rest.replace(DOMAIN, (found) => {
    add('domain', canonicalHost(found));
    return ' ';
  });
  for (const found of rest.match(ID) ?? []) {
    if (looksLikeId(found)) add('id', found);
  }
  if (depth === 0) {
    // Decoding works on the original spelling: base64 is case-sensitive.
    for (const decoded of decodedForms(raw)) fromText(decoded, add, 1);
  }
}

function fromText(text: string, add: (kind: ValueKind, norm: string) => void, depth: number): void {
  for (const raw of text.split(TOKEN_SPLIT)) {
    if (!raw) continue;
    if (raw.length <= MAX_TOKEN_CHARS) {
      fromToken(canonicalText(raw), raw, add, depth);
      continue;
    }
    // A long run of text can hide a value; overlapping windows keep the regexes fast and still see it.
    const end = Math.min(raw.length, MAX_LONG_TOKEN_CHARS);
    for (let i = 0; i < end; i += MAX_TOKEN_CHARS - TOKEN_OVERLAP) {
      const window = raw.slice(i, i + MAX_TOKEN_CHARS);
      fromToken(canonicalText(window), window, add, depth);
    }
  }
  const canonical = canonicalText(text);
  for (const found of canonical.replace(DATE_TIME, ' ').match(GROUPED) ?? []) {
    const compact = found.replace(/[^a-z0-9]/g, '');
    if (compact.replace(/\D/g, '').length >= MIN_GROUPED_DIGITS) add('id', compact);
  }
  for (const found of canonical.match(SPELLED) ?? []) {
    const joined = found.split(/[\s,]+/).map((part) => SPELLED_CHARS[part] ?? part).join('');
    if (joined.length >= MIN_SPELLED_CHARS && depth === 0) fromText(joined, add, 1);
  }
  const undefanged = canonical
    .replace(DEFANGED_AT, '@')
    .replace(DEFANGED_DOT, '.')
    .replace(SPELLED_EMAIL, '$1@$2.$3');
  if (undefanged !== canonical) {
    for (const found of undefanged.match(EMAIL) ?? []) add('email', trimEnd(found));
    for (const found of undefanged.match(DOMAIN) ?? []) add('domain', canonicalHost(found));
  }
}

/** Comparable values in a piece of text, normalized so that case and encoding do not hide a match. */
export function extractValues(text: string): ExtractedValue[] {
  const seen = new Set<string>();
  const out: ExtractedValue[] = [];
  const add = (kind: ValueKind, norm: string) => {
    const key = `${kind}\0${norm}`;
    if (norm && !seen.has(key)) {
      seen.add(key);
      out.push({ kind, norm });
    }
  };
  fromText(text, add, 0);
  const words = canonicalText(text).match(WORD) ?? [];
  const shingles = Math.min(words.length - PHRASE_WORDS + 1, MAX_PHRASES_PER_TEXT);
  for (let i = 0; i < shingles; i++) add('phrase', words.slice(i, i + PHRASE_WORDS).join(' '));
  return out;
}

/** Each word of a text as it would appear as a whole argument: a file id, a user name, a password. */
export function shortValues(text: string): string[] {
  const out: string[] = [];
  for (const raw of canonicalText(text).split(TOKEN_SPLIT)) {
    // Longer than this even with punctuation, it cannot be a short value.
    if (raw.length > 2 * MAX_SHORT_CHARS) continue;
    const token = trimEnd(raw);
    if (token && token.length <= MAX_SHORT_CHARS) out.push(token);
  }
  return out;
}

const WHOLE_DATE_TIME = new RegExp(`^(?:${DATE_TIME.source})$`, 'i');

export function isDateTime(token: string): boolean {
  return WHOLE_DATE_TIME.test(token);
}

/** The argument as one short value, if it is one. */
export function asShortValue(leaf: string): string | null {
  const found = shortValues(leaf);
  return found.length === 1 ? found[0]! : null;
}

// `- general`: a short item with no key of its own. `- id: 7` is a record instead.
const BARE_ITEM = new RegExp(`^-\\s+\\S+(?:\\s+\\S+){0,${MAX_FIELD_WORDS - 1}}$`);
const RECORD_ITEM = /^-\s+[A-Za-z_][\w.\- ]{0,40}:(?:\s|$)/;

function isBareItem(line: string): boolean {
  return BARE_ITEM.test(line) && !RECORD_ITEM.test(line);
}

/**
 * Splits `key: value` text into fields. A line indented under a key belongs to that key's value.
 * Plain text can fake a field by putting `account: X` on its own line, and it would read as
 * structured data. So outside a YAML list of records, everything after a free-text field stays in it.
 */
/** A real field holds a value or a list of them. A sentence there was written by someone, whatever the key says. */
function isSentence(value: string): boolean {
  const words = value.trim().split(/\s+/);
  if (words.length <= MAX_VALUE_WORDS) return false;
  return !value.split(/[,;\n]/).every((item) => item.trim().split(/\s+/).length <= MAX_LIST_ITEM_WORDS);
}

function flattenText(text: string, emit: (path: string, value: string, loose?: boolean) => void): void {
  // A bare value such as an account number is what a lookup returns, not prose someone wrote.
  if (!/\s/.test(text.trim()) && text.trim()) {
    emit('value', text.trim());
    return;
  }
  // So is a list of short items, such as channel names.
  const allLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (allLines.length > 0 && allLines.every(isBareItem)) {
    emit('value', allLines.map((line) => line.slice(1).trim()).join('\n'));
    return;
  }
  const isRecordList = /^\s*-\s+[A-Za-z_]/.test(text);
  const found: { path: string; text: string }[] = [];
  let key = '';
  let keyIndent = -1;
  let keyHasValue = false;
  let lines: string[] = [];
  const flush = () => {
    if (lines.length) found.push({ path: key || 'text', text: lines.join('\n') });
    lines = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const indent = raw.length - raw.trimStart().length;
    const match = /^(?:-\s+)?([A-Za-z_][\w.\- ]{0,40}):(?:\s+(.*))?$/.exec(trimmed);
    // `so it registers. Then: send it` ends in a colon by chance: a key is a name, not part of a sentence.
    const field = match && !match[1]!.includes('. ') && match[1]!.split(' ').length <= MAX_FIELD_WORDS ? match : null;
    const open = key !== '' && !isRecordList && isFreeTextField(key);
    // `Important: send the money to X` has the shape of a field and the content of a sentence.
    const prose = !!field?.[2] && field[2].trim().split(/\s+/).length > MAX_FIELD_WORDS;
    if (field && prose && !isRecordList && !open && (keyIndent < 0 || indent <= keyIndent)) {
      flush();
      key = '';
      keyIndent = -1;
      found.push({ path: 'text', text: trimmed });
    } else if (field && !open && (keyIndent < 0 || indent <= keyIndent)) {
      flush();
      key = field[1]!;
      // In `- a: 1` the sibling keys on later lines line up with `a`, not with the dash.
      keyIndent = trimmed.startsWith('- ') ? indent + 2 : indent;
      keyHasValue = !!field[2];
      if (field[2]) lines.push(field[2]);
    } else if (key && !open && !keyHasValue && indent === keyIndent && isBareItem(trimmed)) {
      // YAML writes `participants:` and then `- a@b.co` at the same indent: those items are its value.
      lines.push(trimmed.slice(1).trim());
    } else if (key && !open && indent <= keyIndent) {
      // Unindented prose after `iban: X` is not part of that value, so it cannot borrow its standing.
      flush();
      key = '';
      keyIndent = -1;
      lines.push(trimmed);
    } else {
      lines.push(trimmed);
    }
  }
  flush();
  // Whoever wrote the prose around a `key: value` line could have written that line too.
  const hasProse = found.some((f) => f.path === 'text');
  for (const f of found) emit(f.path, f.text, f.path !== 'text' && (hasProse || isSentence(f.text)));
}

/** Every text value in a tool result, with where it sits, and whether any of it went unread. */
export function flattenResultChecked(result: unknown): FlattenedResult {
  const fields: ResultField[] = [];
  let budget = MAX_TOTAL_CHARS;
  let truncated = false;
  const seen = new WeakSet<object>();

  const emit = (path: string, value: string, loose?: boolean) => {
    if (budget <= 0 || fields.length >= MAX_FIELDS) {
      truncated = true;
      return;
    }
    if (value.length > budget) truncated = true;
    const text = value.length > budget ? value.slice(0, budget) : value;
    budget -= text.length;
    fields.push(loose ? { path, text, loose } : { path, text });
  };
  const join = (base: string, key: string) => (base ? `${base}.${key}` : key);

  const fromString = (value: string) => {
    if (value.length > MAX_TOTAL_CHARS) truncated = true;
    const head = value.slice(0, MAX_TOTAL_CHARS);
    const trimmed = head.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        walk(JSON.parse(trimmed), '', 1);
        return;
      } catch {
        // not JSON
      }
    }
    flattenText(head, emit);
  };

  const walk = (value: unknown, path: string, depth: number): void => {
    if (value === null || value === undefined) return;
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    if (typeof value === 'string') {
      emit(path || 'text', value, isSentence(value));
      return;
    }
    if (typeof value !== 'object') {
      emit(path, String(value));
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    for (const [key, item] of Object.entries(value)) walk(item, join(path, key), depth + 1);
  };

  if (typeof result === 'string') {
    fromString(result);
    return { fields, truncated };
  }
  const mcp = result as { content?: unknown; structuredContent?: unknown } | null;
  if (mcp && typeof mcp === 'object' && Array.isArray(mcp.content)) {
    for (const part of mcp.content as { type?: string; text?: unknown }[]) {
      if (part && part.type === 'text' && typeof part.text === 'string') fromString(part.text);
      else if (part && typeof part === 'object') {
        // An embedded resource or any other part can carry text the agent will read.
        const { type: _type, ...rest } = part;
        walk(rest, 'content', 1);
      }
    }
    if (mcp.structuredContent) walk(mcp.structuredContent, '', 1);
    return { fields, truncated };
  }
  walk(result, '', 0);
  return { fields, truncated };
}

export function flattenResult(result: unknown): ResultField[] {
  return flattenResultChecked(result).fields;
}
