/**
 * Decides when to tell the user about new blocks: never about blocks that were there before the
 * editor started, only for this editor's agents, at most once per interval, and several at once
 * as a single "Shield blocked N calls".
 */
import type { BlockRow } from './blocks';

export interface BlockNote {
  text: string;
  /** Set when the note is about a single block, so "Show details" can reveal it. */
  rowId?: string;
}

const SEEN_MAX = 500;

export class BlockNotifier {
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private pending: BlockRow[] = [];
  private started = false;
  private lastNoteAt: number | null = null;

  constructor(private readonly intervalMs = 30_000) {}

  observe(rowsNewestFirst: BlockRow[], agents: Set<string>, nowMs: number): BlockNote | null {
    const fresh: BlockRow[] = [];
    for (const row of [...rowsNewestFirst].reverse()) {
      if (this.seen.has(row.id)) continue;
      this.remember(row.id);
      if (this.started && agents.has(row.agent)) fresh.push(row);
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
      return { text: `Shield blocked ${r.tool} on ${r.server}: ${r.layer ?? r.rule ?? r.reason}`, rowId: r.id };
    }
    return { text: `Shield blocked ${rows.length} calls` };
  }

  private remember(id: string): void {
    this.seen.add(id);
    this.seenOrder.push(id);
    while (this.seenOrder.length > SEEN_MAX) this.seen.delete(this.seenOrder.shift() as string);
  }
}
