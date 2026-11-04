/**
 * Remembers, per session, which values appeared in tool results and where. A later call's arguments
 * are compared against it. Taint belongs to a value, not to the whole session, so reading one bad
 * email does not make every later call suspect.
 */
import { createHash } from 'node:crypto';
import { asShortValue, extractValues, flattenResultChecked, isDateTime, shortValues, type ValueKind } from './values.js';
import { originOf, type Origin } from './origins.js';

export interface SessionKey {
  tenantId?: string;
  sessionId?: string;
  connectionId: string;
}

export interface ValueSource {
  server: string;
  tool: string;
  fieldPath: string;
  origin: Origin;
}

export interface OriginMatch {
  argPath: string;
  value: string;
  kind?: ValueKind;
  /** The value itself never appeared: it is built from attacker-writable pieces, or reversed from one. */
  built?: boolean;
  sources: ValueSource[];
}

/** What the ledger can say about a call's arguments. */
export interface ArgAssessment {
  matches: OriginMatch[];
  /** Comparable values per argument path, whether seen before or not. */
  values: Map<string, string[]>;
  /** Whole arguments too short to compare in general, such as `13`. Only worth asking on the riskiest calls. */
  shortMatches: OriginMatch[];
  /** Those whole arguments per path, whether seen before or not. */
  shortArgs: Map<string, string>;
  /** The arguments were too large or deep to read in full. */
  argsTruncated: boolean;
  /** Some result went unread, or values were evicted, so "never seen" proves nothing here. */
  ledgerIncomplete: boolean;
  /** The same, for phrases and short values, which only the riskiest calls ask about. */
  riskyIncomplete: boolean;
}

export interface RecordOptions {
  /** What the agent passed to this call: a server repeating it says nothing about where it came from. */
  ownArgs?: ReadonlySet<string>;
  /** Text not tied to this session, where any word could match by chance. */
  skipShortValues?: boolean;
}

export interface OriginLedgerOptions {
  maxSessions?: number;
  maxValuesPerSession?: number;
  ttlMs?: number;
}

interface Session {
  values: Map<string, ValueSource[]>;
  /** Kept apart from `values`: ordinary prose would fill it, and what the user said must not be evicted. */
  trusted: Map<string, ValueSource>;
  phrases: Map<string, ValueSource[]>;
  shortValues: Map<string, ValueSource[]>;
  /** Hashes of values a verified peer gateway labelled as attacker-written. */
  peerTainted: Set<string>;
  incomplete: boolean;
  riskyIncomplete: boolean;
  /** Attacker-written values the agent has passed to a read: a reply repeating one proves nothing. */
  echoSuspects: Set<string>;
  touchedAt: number;
}

const MAX_SOURCES_PER_VALUE = 4;
const MAX_RISKY_ENTRIES = 20_000;
const MIN_PIECE_CHARS = 4;
const MAX_PIECE_CHARS = 64;
const MIN_PIECES = 2;
const MAX_BUILT_CHARS = 128;
const MIN_BUILT_COVERAGE = 0.7;
const MIN_REVERSED_CHARS = 6;
const MAX_BUILT_LOOKUPS = 200_000;
const DOMAIN_ENDING = /\.[a-z]{2,}(?:[/:?#]|$)/;
const MAX_ARG_LEAVES = 500;
const MAX_ARG_DEPTH = 12;

export function valueHash(norm: string): string {
  return createHash('sha256').update(norm).digest('hex');
}

function sessionId(key: SessionKey): string {
  const scope = key.sessionId ? `s:${key.sessionId}` : `c:${key.connectionId}`;
  return `${key.tenantId ?? ''}\0${scope}`;
}

/**
 * Calls `visit` for each string or number in `value`, with a path such as `to[0]` or `meta.host`.
 * Returns false if the caps stopped it reading everything.
 */
export function walkArgs(value: unknown, visit: (path: string, leaf: string) => void): boolean {
  let leaves = 0;
  let complete = true;
  const seen = new WeakSet<object>();
  const walk = (node: unknown, path: string, depth: number) => {
    if (node === null || node === undefined) return;
    if (leaves >= MAX_ARG_LEAVES || depth > MAX_ARG_DEPTH) {
      complete = false;
      return;
    }
    if (typeof node === 'string' || typeof node === 'number') {
      leaves++;
      visit(path, String(node));
    } else if (typeof node === 'object') {
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      else for (const [k, item] of Object.entries(node)) walk(item, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(value, '', 0);
  return complete;
}

export class OriginLedger {
  private readonly sessions = new Map<string, Session>();
  private readonly maxSessions: number;
  private readonly maxValues: number;
  private readonly ttlMs: number;

  constructor(options: OriginLedgerOptions = {}) {
    this.maxSessions = options.maxSessions ?? 10_000;
    this.maxValues = options.maxValuesPerSession ?? 5_000;
    this.ttlMs = options.ttlMs ?? 3_600_000;
  }

  private session(key: SessionKey, create: boolean): Session | undefined {
    const id = sessionId(key);
    const now = Date.now();
    let session = this.sessions.get(id);
    if (session && now - session.touchedAt > this.ttlMs) {
      this.sessions.delete(id);
      session = undefined;
    }
    if (!session) {
      if (!create) return undefined;
      session = { values: new Map(), trusted: new Map(), phrases: new Map(), shortValues: new Map(), peerTainted: new Set(), incomplete: false, riskyIncomplete: false, echoSuspects: new Set(), touchedAt: now };
    } else {
      this.sessions.delete(id); // re-insert below: the map's order is least recently used first
    }
    session.touchedAt = now;
    this.sessions.set(id, session);
    while (this.sessions.size > this.maxSessions) {
      this.sessions.delete(this.sessions.keys().next().value as string);
    }
    return session;
  }

  private add(session: Session, norm: string, source: ValueSource): void {
    if (source.origin === 'trusted') {
      if (session.trusted.size < this.maxValues) session.trusted.set(norm, source);
      return;
    }
    if (source.origin === 'unknown' && session.echoSuspects.has(norm)) return;
    let sources = session.values.get(norm);
    if (!sources) {
      sources = [];
      session.values.set(norm, sources);
      while (session.values.size > this.maxValues) {
        session.values.delete(session.values.keys().next().value as string);
        session.incomplete = true;
      }
    }
    const duplicate = sources.some(
      (s) => s.server === source.server && s.tool === source.tool && s.fieldPath === source.fieldPath,
    );
    if (duplicate) return;
    if (sources.length < MAX_SOURCES_PER_VALUE) {
      sources.push(source);
    } else if (!sources.some((s) => s.origin === source.origin)) {
      // A full list must still show every kind of origin; the decision depends on that.
      sources[sources.length - 1] = source;
    }
  }

  private addRisky(session: Session, table: Map<string, ValueSource[]>, norm: string, source: ValueSource): void {
    if (source.origin === 'unknown' && session.echoSuspects.has(norm)) return;
    let sources = table.get(norm);
    if (!sources) {
      if (table.size >= MAX_RISKY_ENTRIES) {
        session.riskyIncomplete = true;
        return;
      }
      sources = [];
      table.set(norm, sources);
    }
    if (!sources.some((s) => s.origin === source.origin)) sources.push(source);
  }

  /** `originOverride` replaces the structural origin, for sources with their own rule such as memory. */
  recordResult(
    key: SessionKey,
    server: string,
    tool: string,
    result: unknown,
    originOverride?: (norm: string, fieldPath: string) => Origin,
    options: RecordOptions = {},
  ): void {
    const { ownArgs, skipShortValues } = options;
    const session = this.session(key, true)!;
    const { fields, truncated } = flattenResultChecked(result);
    if (truncated) session.incomplete = true;
    for (const field of fields) {
      const structural = field.loose ? 'attacker_writable' : originOf(tool, field.path);
      for (const value of extractValues(field.text)) {
        if (ownArgs?.has(value.norm)) continue;
        const origin = originOverride ? originOverride(value.norm, field.path) : structural;
        const source = { server, tool, fieldPath: field.path, origin };
        if (value.kind !== 'phrase') this.add(session, value.norm, source);
        // Copying a sentence only points at a source when that source is free text.
        else if (origin === 'attacker_writable') this.addRisky(session, session.phrases, value.norm, source);
      }
      if (skipShortValues) continue;
      for (const token of shortValues(field.text)) {
        if (ownArgs?.has(token)) continue;
        const origin = originOverride ? originOverride(token, field.path) : structural;
        this.addRisky(session, session.shortValues, token, { server, tool, fieldPath: field.path, origin });
      }
    }
  }

  /** Whether the user's own request vouched for any of these values, or named this short one. */
  isTrusted(key: SessionKey, norms: string[], shorts: string[] = []): boolean {
    const session = this.session(key, false);
    if (session && shorts.some((s) => session.shortValues.get(s)?.some((source) => source.origin === 'trusted'))) return true;
    return !!session && norms.some((n) => session.trusted.has(n));
  }

  /** Call before a read runs. Its reply may repeat these values in structured fields. */
  markEchoSuspects(key: SessionKey, norms: string[]): void {
    const session = this.session(key, false);
    if (session) for (const norm of norms.slice(0, this.maxValues)) session.echoSuspects.add(norm);
  }

  addPeerTaint(key: SessionKey, hashes: string[]): void {
    const session = this.session(key, true)!;
    for (const hash of hashes.slice(0, this.maxValues)) session.peerTainted.add(hash);
  }

  /** Values the user or their agent framework vouches for, such as the user's own request. */
  recordTrusted(key: SessionKey, text: string): void {
    const session = this.session(key, true)!;
    for (const value of extractValues(text)) {
      this.add(session, value.norm, { server: 'user', tool: 'request', fieldPath: 'text', origin: 'trusted' });
    }
    for (const token of shortValues(text)) {
      this.addRisky(session, session.shortValues, token, { server: 'user', tool: 'request', fieldPath: 'text', origin: 'trusted' });
    }
  }

  assessArgs(key: SessionKey, args: unknown): ArgAssessment {
    const session = this.session(key, false);
    const matches: OriginMatch[] = [];
    const shortMatches: OriginMatch[] = [];
    const shortArgs = new Map<string, string>();
    const values = new Map<string, string[]>();
    const complete = walkArgs(args, (path, leaf) => {
      const comparable: string[] = [];
      for (const value of extractValues(leaf)) {
        if (value.kind !== 'phrase') comparable.push(value.norm);
        if (!session) continue;
        const sources = [...((value.kind === 'phrase' ? session.phrases : session.values).get(value.norm) ?? [])];
        const vouched = session.trusted.get(value.norm);
        if (vouched) sources.push(vouched);
        if (session.peerTainted.size > 0 && session.peerTainted.has(valueHash(value.norm))) {
          sources.push({ server: 'peer', tool: 'peer-gateway', fieldPath: 'label', origin: 'attacker_writable' });
        }
        if (sources.length > 0) matches.push({ argPath: path, value: value.norm, kind: value.kind, sources });
      }
      if (comparable.length) values.set(path, comparable);
      const short = asShortValue(leaf);
      if (short === null) return;
      shortArgs.set(path, short);
      const sources = session?.shortValues.get(short);
      if (sources) shortMatches.push({ argPath: path, value: short, kind: 'short', sources: [...sources] });
    });
    return {
      matches,
      shortMatches,
      shortArgs,
      values,
      argsTruncated: !complete,
      ledgerIncomplete: session?.incomplete ?? false,
      riskyIncomplete: session?.riskyIncomplete ?? false,
    };
  }

  /**
   * Targets that never appeared, but whose text is made of what did. "Join 'US1330' and '0001212'" leaves
   * no whole value to find, yet each piece is still in the ledger. One piece is not enough: a new address
   * on a domain an email mentioned is ordinary. So it takes two pieces only attacker-writable data held,
   * covering most of the target, or the whole target written backwards. `exhausted` means the arguments
   * had too much to check, so that filler cannot hide a built value behind it.
   */
  builtMatches(key: SessionKey, args: unknown): { matches: OriginMatch[]; exhausted: boolean } {
    const session = this.session(key, false);
    if (!session || session.shortValues.size === 0) return { matches: [], exhausted: false };
    const onlyAttacker = (text: string): ValueSource[] | null => {
      const sources = session.shortValues.get(text);
      return sources?.length && sources.every((s) => s.origin === 'attacker_writable') ? sources : null;
    };
    let lookups = 0;
    const out: OriginMatch[] = [];
    const checked = new Set<string>();
    walkArgs(args, (path, leaf) => {
      for (const raw of shortValues(leaf)) {
        const token = raw.replace(/^https?:\/\//, '');
        // Only something shaped like a target: `meeting-notes` built from two words of an email is not.
        const kind: ValueKind | null = token.includes('@') ? 'email' : DOMAIN_ENDING.test(token) ? 'domain' : /\d/.test(token) ? 'id' : null;
        if (!kind || token.length > MAX_BUILT_CHARS || isDateTime(token) || checked.has(token)) continue;
        checked.add(token);
        if (session.values.has(token) || session.trusted.has(token) || session.shortValues.has(token) || session.shortValues.has(raw)) continue;
        const reversed = token.length >= MIN_REVERSED_CHARS ? onlyAttacker([...token].reverse().join('')) : null;
        if (reversed) {
          out.push({ argPath: path, value: token, kind, built: true, sources: reversed });
          continue;
        }
        let covered = 0;
        const sources: ValueSource[] = [];
        let pieces = 0;
        let digitPieces = 0;
        for (let i = 0; i < token.length && lookups < MAX_BUILT_LOOKUPS; ) {
          let found = 0;
          for (let len = Math.min(MAX_PIECE_CHARS, token.length - i); len >= MIN_PIECE_CHARS && !found; len--) {
            lookups++;
            const hit = onlyAttacker(token.slice(i, i + len));
            if (hit) {
              found = len;
              sources.push(...hit.filter((s) => !sources.some((have) => have.tool === s.tool && have.fieldPath === s.fieldPath)));
            }
          }
          if (found) {
            covered += found;
            pieces++;
            if (/\d/.test(token.slice(i, i + found))) digitPieces++;
          }
          i += found || 1;
        }
        // An id takes two pieces with digits: `budget-2024` is a word and a year, not a split account.
        const enoughPieces = kind === 'id' ? digitPieces >= MIN_PIECES : pieces >= MIN_PIECES;
        if (enoughPieces && covered / token.length >= MIN_BUILT_COVERAGE) {
          out.push({ argPath: path, value: token, kind, built: true, sources });
        }
      }
    });
    return { matches: out, exhausted: lookups >= MAX_BUILT_LOOKUPS };
  }

  matchArgs(key: SessionKey, args: unknown): OriginMatch[] {
    return this.assessArgs(key, args).matches;
  }

  sessionValueCount(key: SessionKey): number {
    return this.session(key, false)?.values.size ?? 0;
  }
}
