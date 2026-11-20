import { PLAYGROUND } from '@/app/attack-lab/playground-data';
import type { PlayExample } from '@/app/attack-lab/playground-types';

/**
 * The Protocol X arena: the visitor throws recorded attacks (or a harmless call) at the model.
 * Every verdict, score and time is a recorded run from the red-team suite; nothing calls the model.
 */

export type ArenaGoalId = 'prompt-injection' | 'credential-exfil' | 'cross-tool-chain' | 'boundary-evasion' | 'harmless';

export const ARENA_GOALS: { id: ArenaGoalId; label: string }[] = [
  { id: 'prompt-injection', label: 'Hijack the agent' },
  { id: 'credential-exfil', label: 'Steal keys' },
  { id: 'cross-tool-chain', label: 'Redirect next tool' },
  { id: 'boundary-evasion', label: 'Escape the folder' },
  { id: 'harmless', label: 'Harmless call' },
];

const pools = new Map<ArenaGoalId, PlayExample[]>();

/** Every recorded example for a goal, across all disguises, in a fixed interleaved order. */
export function arenaPool(goal: ArenaGoalId): PlayExample[] {
  const cached = pools.get(goal);
  if (cached) return cached;
  const groups =
    goal === 'harmless'
      ? Object.values(PLAYGROUND.harmless).map((h) => h.examples)
      : Object.entries(PLAYGROUND.cells)
          .filter(([key]) => key.startsWith(`${goal}:`))
          .map(([, cell]) => cell.examples);
  const out: PlayExample[] = [];
  const longest = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < longest; i++) for (const g of groups) if (g[i]) out.push(g[i]);
  pools.set(goal, out);
  return out;
}

/** The example at position `index` (wrapping), and the index to use next time. */
export function nextThrow(goal: ArenaGoalId, index: number): { example: PlayExample; next: number } {
  const pool = arenaPool(goal);
  const i = ((index % pool.length) + pool.length) % pool.length;
  return { example: pool[i], next: i + 1 };
}

/** Cuts the payload around the hidden instruction so it can be highlighted. */
export function splitPayload(payload: string, hidden: string | undefined): { text: string; hidden: boolean }[] {
  const at = hidden ? payload.indexOf(hidden) : -1;
  if (!hidden || at < 0) return [{ text: payload, hidden: false }];
  const parts = [
    { text: payload.slice(0, at), hidden: false },
    { text: hidden, hidden: true },
    { text: payload.slice(at + hidden.length), hidden: false },
  ];
  return parts.filter((p) => p.text.length > 0);
}
