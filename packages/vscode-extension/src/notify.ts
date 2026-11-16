/**
 * Decides when to tell the user about new blocks: never about blocks that were there before the
 * editor started, only for this editor's blocks, at most once per interval, and several at once
 * as a single "Shield blocked N calls".
 */
import type { BlockRow } from './blocks';

export interface BlockNote {
  text: string;
  /** Set when the note is about a single block, so "Show details" can reveal it. */
  rowId?: string;
}

const SEEN_MAX = 500;

/** Notifications render [text](link) as a link, command: links included; names come from MCP servers. */
const plain = (s: string) => s.replace(/[[\]]/g, '').replace(/\]\(/g, '');

export class BlockNotifier {
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private pending: BlockRow[] = [];
  private started = false;
  private lastNoteAt: number | null = null;

  constructor(private readonly intervalMs = 30_000) {}

  /** `belongs` says whether a block is this editor's (Shield 0.5.2 records no agent, so callers match by server name). */
  observe(rowsNewestFirst: BlockRow[], belongs: (row: BlockRow) => boolean, nowMs: number): BlockNote | null {
    const fresh: BlockRow[] = [];
    for (const row of [...rowsNewestFirst].reverse()) {
      if (this.seen.has(row.id)) continue;
      this.remember(row.id);
      if (this.started && belongs(row)) fresh.push(row);
    }
    if (!this.started) {
      this.started = true;
      return null;
    }

    this.pending.push(...fresh);
    if (this.pending.length === 0) return null;
    if (this.lastNoteAt !== null && nowMs - this.lastNoteAt < this.intervalMs) return null;

    const rows = this.pending;
    this.pending = [];
    this.lastNoteAt = nowMs;
    if (rows.length === 1) {
      const r = rows[0];
      return { text: plain(`Shield blocked ${r.tool} on ${r.server}: ${r.layer ?? r.rule ?? r.reason}`), rowId: r.id };
    }
    return { text: `Shield blocked ${rows.length} calls` };
  }

  private remember(id: string): void {
    this.seen.add(id);
    this.seenOrder.push(id);
    while (this.seenOrder.length > SEEN_MAX) this.seen.delete(this.seenOrder.shift() as string);
  }
}
