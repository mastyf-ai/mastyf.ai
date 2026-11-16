import { describe, expect, it } from 'vitest';
import { BlockNotifier } from '../src/notify';
import type { BlockRow } from '../src/blocks';

const row = (id: string, agent = 'vscode', extra: Partial<BlockRow> = {}): BlockRow => ({
  id,
  tool: 'read_file',
  server: 'shield-demo',
  agent,
  at: null,
  reason: 'hook-before: Path not in allowed list',
  layer: 'Tool-call hook',
  ...extra,
});

const agents = new Set(['vscode']);

describe('BlockNotifier', () => {
  it('the first look only remembers what is already there', () => {
    const n = new BlockNotifier();
    expect(n.observe([row('old1'), row('old2')], agents, 0)).toBeNull();
    expect(n.observe([row('old1'), row('old2')], agents, 60_000)).toBeNull();
  });

  it('one new block: one note naming the tool, server and layer', () => {
    const n = new BlockNotifier();
    n.observe([row('old')], agents, 0);
    expect(n.observe([row('new'), row('old')], agents, 60_000)).toEqual({
      text: 'Shield blocked read_file on shield-demo: Tool-call hook',
      rowId: 'new',
    });
  });

  it('falls back to the rule, then the reason, when no layer was recorded', () => {
    const n = new BlockNotifier();
    n.observe([], agents, 0);
    expect(n.observe([row('a', 'vscode', { layer: undefined, rule: 'Prompt injection' })], agents, 60_000)?.text).toBe(
      'Shield blocked read_file on shield-demo: Prompt injection',
    );
    expect(n.observe([row('b', 'vscode', { layer: undefined })], agents, 120_000)?.text).toBe(
      'Shield blocked read_file on shield-demo: hook-before: Path not in allowed list',
    );
  });

  it('at most one note every 30 seconds; blocks in between are carried into the next note', () => {
    const n = new BlockNotifier();
    n.observe([], agents, 0);
    expect(n.observe([row('a')], agents, 60_000)?.rowId).toBe('a');
    expect(n.observe([row('c'), row('b'), row('a')], agents, 70_000)).toBeNull();
    expect(n.observe([row('c'), row('b'), row('a')], agents, 90_000)).toEqual({ text: 'Shield blocked 2 calls' });
  });

  it("another agent's blocks never notify here", () => {
    const n = new BlockNotifier();
    n.observe([], agents, 0);
    expect(n.observe([row('x', 'claude-desktop')], agents, 60_000)).toBeNull();
    expect(n.observe([row('x', 'claude-desktop')], agents, 120_000)).toBeNull();
  });

  it('a hundred new blocks at once (after sleep) give exactly one note', () => {
    const n = new BlockNotifier();
    n.observe([], agents, 0);
    const many = Array.from({ length: 100 }, (_, i) => row(`m${i}`));
    expect(n.observe(many, agents, 60_000)).toEqual({ text: 'Shield blocked 100 calls' });
    expect(n.observe(many, agents, 120_000)).toBeNull();
  });
});
