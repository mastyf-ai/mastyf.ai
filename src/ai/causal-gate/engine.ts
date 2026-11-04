/**
 * The gate's decisions with no logging or environment, so the benchmark sidecar runs exactly the code
 * the proxy runs.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { decide, type GateDecision } from './decide.js';
import { classifyEffect, messageArgs, sensitiveArgs, type ToolAnnotations } from './effect.js';
import {
  OriginLedger,
  valueHash,
  walkArgs,
  type ArgAssessment,
  type OriginLedgerOptions,
  type OriginMatch,
  type SessionKey,
} from './ledger.js';
import { MemoryTaintStore, memoryToolKind, type TaintStore } from './memory-taint.js';
import { isFreeTextField } from './origins.js';
import { extractValues } from './values.js';

export interface PeerTaintLabel {
  hashes: string[];
  sig: string;
}

export interface CausalEngineOptions extends OriginLedgerOptions {
  taintStore?: TaintStore;
  /** Shared by gateways that may tell each other which values are attacker-written. */
  peerSecret?: string;
}

const NO_TENANT = 'default';
// Tool descriptions, resources and prompts belong to a server rather than a session, and an agent can
// act on them much later. Matching one only ever holds a call; it reveals nothing to the caller.
const PUBLISHED_KEY: SessionKey = { connectionId: 'published' };
const MAX_TOOL_ANNOTATIONS = 10_000;
const MAX_PENDING_READS = 10_000;
// A read still waiting after this long was stopped by a later gate, or its result was lost.
const PENDING_READ_MS = 30_000;
// `a` or `in` naming a read would be a coincidence.
const MIN_NAMED_SHORT_CHARS = 3;

function delegationKey(key: SessionKey, tool: string): string {
  return `${key.tenantId ?? ''}\0${key.sessionId ?? key.connectionId}\0${tool}`;
}

function annotationKey(server: string, tool: string): string {
  return `${server}\0${tool}`;
}

function onlyAttackerWritable(match: OriginMatch): boolean {
  return match.sources.length > 0 && match.sources.every((s) => s.origin === 'attacker_writable');
}

export class CausalEngine {
  readonly ledger: OriginLedger;
  private readonly taint: TaintStore;
  private readonly peerSecret?: string;
  /** By server and tool: one server's word about a tool must not reach a tool of the same name elsewhere. */
  private readonly annotations = new Map<string, ToolAnnotations>();
  /** Reads awaiting their result, by session and tool, and whether the user named all of them. */
  private readonly pendingReads = new Map<string, { named: boolean; at: number; count: number }>();
  /** What the agent last passed to each tool, by session, so that a reply repeating it adds no taint. */
  private readonly ownArgs = new Map<string, Set<string>>();

  constructor(options: CausalEngineOptions = {}) {
    this.ledger = new OriginLedger(options);
    this.taint = options.taintStore ?? new MemoryTaintStore();
    this.peerSecret = options.peerSecret;
  }

  observe(key: SessionKey, server: string, tool: string, result: unknown): void {
    const ownKey = delegationKey(key, tool);
    const ownArgs = this.ownArgs.get(ownKey);
    this.ownArgs.delete(ownKey);
    const pending = this.pendingReads.get(ownKey);
    if (pending && --pending.count <= 0) this.pendingReads.delete(ownKey);
    if (pending?.named) {
      // "Pay the bill in bill.txt": the user chose this source, so its structured fields count. Its
      // sentences do not, which keeps an injected "send it to X" line in the same file untrusted.
      this.ledger.recordResult(
        key,
        server,
        tool,
        result,
        (_norm, fieldPath) => (fieldPath === 'text' || isFreeTextField(fieldPath) ? 'attacker_writable' : 'unknown'),
        { ownArgs },
      );
      return;
    }
    if (memoryToolKind(tool) === 'read') {
      const tenant = key.tenantId ?? NO_TENANT;
      this.ledger.recordResult(
        key,
        server,
        tool,
        result,
        (norm) => (this.taint.has(tenant, norm) ? 'attacker_writable' : 'unknown'),
        { ownArgs },
      );
      return;
    }
    this.ledger.recordResult(key, server, tool, result, undefined, { ownArgs });
  }

  /** What a server says about its tools is its own word, so all of it counts as attacker-writable. */
  observeToolList(server: string, tools: readonly { name?: unknown; annotations?: unknown }[]): void {
    this.ledger.recordResult(PUBLISHED_KEY, server, 'tools/list', { tools }, () => 'attacker_writable', { skipShortValues: true });
    for (const tool of tools) {
      if (typeof tool.name !== 'string' || !tool.annotations) continue;
      if (this.annotations.size >= MAX_TOOL_ANNOTATIONS) break;
      this.annotations.set(annotationKey(server, tool.name), tool.annotations as ToolAnnotations);
    }
  }

  observePublished(server: string, method: string, result: unknown): void {
    this.ledger.recordResult(PUBLISHED_KEY, server, method, result, () => 'attacker_writable', { skipShortValues: true });
  }

  trust(key: SessionKey, text: string): void {
    this.ledger.recordTrusted(key, text);
  }

  check(
    key: SessionKey,
    tool: string,
    args: unknown,
    options: { annotations?: ToolAnnotations; server?: string } = {},
  ): GateDecision {
    const effect = classifyEffect(tool, args, options.annotations ?? this.annotationsFor(options.server, tool));
    const assessed = this.assess(key, args, options.server);
    if (this.ownArgs.size < MAX_PENDING_READS) {
      this.ownArgs.set(delegationKey(key, tool), new Set([...assessed.values.values()].flat().concat([...assessed.shortArgs.values()])));
    }
    if (memoryToolKind(tool) === 'write' && assessed.matches.some(onlyAttackerWritable)) this.taintWrite(key, args);
    if (effect === 'read') {
      const suspects = [...assessed.matches, ...assessed.shortMatches].filter(onlyAttackerWritable);
      this.ledger.markEchoSuspects(key, suspects.map((m) => m.value));
      this.trackRead(key, tool, assessed);
    }
    // On a call that deletes, runs or grants, even `13` is worth asking about. Elsewhere it matches by chance.
    const everyValue = effect === 'irreversible' || effect === 'privilege';
    const values = new Map(assessed.values);
    if (everyValue) {
      for (const [path, short] of assessed.shortArgs) values.set(path, [...(values.get(path) ?? []), short]);
    }
    const built = effect === 'read' ? { matches: [], exhausted: false } : this.ledger.builtMatches(key, args);
    return decide({
      tool,
      effect,
      sensitive: sensitiveArgs(args, effect),
      messages: messageArgs(args, effect),
      matches: [
        ...assessed.matches,
        ...(everyValue ? assessed.shortMatches : []),
        ...built.matches,
      ],
      values,
      argsTruncated: assessed.argsTruncated || built.exhausted,
      ledgerIncomplete: assessed.ledgerIncomplete || (everyValue && assessed.riskyIncomplete),
      exfilUrl: effect === 'read' ? this.exfilUrl(args, assessed.matches) : undefined,
    });
  }

  private annotationsFor(server: string | undefined, tool: string): ToolAnnotations | undefined {
    return server === undefined ? undefined : this.annotations.get(annotationKey(server, tool));
  }

  /**
   * Two reads of one tool at once cannot be told apart when their results return, so a read only counts
   * as named if every read still waiting was named too. A read left waiting by a later gate expires.
   */
  private trackRead(key: SessionKey, tool: string, assessed: ArgAssessment): void {
    const readKey = delegationKey(key, tool);
    const shorts = [...assessed.shortArgs.values()].filter((s) => s.length >= MIN_NAMED_SHORT_CHARS);
    const named = this.ledger.isTrusted(key, [...assessed.values.values()].flat(), shorts);
    const now = Date.now();
    const prior = this.pendingReads.get(readKey);
    const waiting = prior && now - prior.at < PENDING_READ_MS ? prior : undefined;
    if (this.pendingReads.size >= MAX_PENDING_READS && !prior) return;
    this.pendingReads.set(readKey, { named: named && (waiting?.named ?? true), at: now, count: (waiting?.count ?? 0) + 1 });
  }

  /**
   * What this session read, combined with what servers have published. A server's word only counts
   * against other servers' tools: its own tools already receive whatever it asks for, and its schema
   * naming a value is how a normal call works. How much was published says nothing about this session.
   */
  private assess(key: SessionKey, args: unknown, server?: string): ArgAssessment {
    const own = this.ledger.assessArgs(key, args);
    for (const match of this.ledger.assessArgs(PUBLISHED_KEY, args).matches) {
      const sources = match.sources.filter((s) => s.server !== server);
      if (sources.length === 0) continue;
      const same = own.matches.find((m) => m.argPath === match.argPath && m.value === match.value);
      if (same) same.sources.push(...sources);
      else own.matches.push({ ...match, sources });
    }
    return own;
  }

  /**
   * Following a link the agent read is normal. Adding a query to one is how a read sends data out:
   * the host only appeared in attacker-writable data, and this exact address never appeared at all.
   */
  private exfilUrl(args: unknown, matches: OriginMatch[]): string | undefined {
    let found: string | undefined;
    walkArgs(args, (path, leaf) => {
      if (found || !/^\s*https?:\/\//i.test(leaf) || !leaf.includes('?')) return;
      const here = matches.filter((m) => m.argPath === path);
      const hostTainted = here.some((m) => !m.value.includes('/') && onlyAttackerWritable(m));
      const exactSeen = here.some((m) => m.value.includes('?'));
      if (hostTainted && !exactSeen) found = leaf.trim();
    });
    return found;
  }

  /** The whole write derives from attacker text, so everything comparable in it stays marked. */
  private taintWrite(key: SessionKey, args: unknown): void {
    const norms: string[] = [];
    walkArgs(args, (_path, leaf) => {
      for (const value of extractValues(leaf)) norms.push(value.norm);
    });
    this.taint.add(key.tenantId ?? NO_TENANT, norms);
  }

  /** A signed list of the attacker-written values in these arguments, for the next gateway. */
  exportTaint(key: SessionKey, args: unknown): PeerTaintLabel | null {
    if (!this.peerSecret) return null;
    const hashes = [...new Set(this.ledger.matchArgs(key, args).filter(onlyAttackerWritable).map((m) => valueHash(m.value)))];
    return hashes.length ? { hashes, sig: this.sign(hashes) } : null;
  }

  /** True if the label verified and now applies to this session. Anything else is ignored. */
  importTaint(key: SessionKey, label: PeerTaintLabel): boolean {
    if (!this.peerSecret || !label || !Array.isArray(label.hashes) || typeof label.sig !== 'string') return false;
    if (!label.hashes.every((h) => typeof h === 'string')) return false;
    const expected = Buffer.from(this.sign(label.hashes));
    const given = Buffer.from(label.sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    this.ledger.addPeerTaint(key, label.hashes);
    return true;
  }

  private sign(hashes: string[]): string {
    return createHmac('sha256', this.peerSecret!).update(hashes.join('\n')).digest('hex');
  }
}
