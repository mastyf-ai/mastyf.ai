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

/* ------------------------------------------------------------ goal × disguise × release */

export type ArenaDisguiseId = 'split-assembly' | 'delayed-trigger' | 'error-recovery';
export type Release = 'now' | 'before';

export const ARENA_DISGUISES: { id: ArenaDisguiseId; label: string }[] = [
  { id: 'split-assembly', label: 'Split into pieces' },
  { id: 'delayed-trigger', label: 'Delayed until later' },
  { id: 'error-recovery', label: 'Posed as an error' },
];

export const RELEASE_LABEL: Record<Release, string> = {
  now: PLAYGROUND.releases.now,
  before: PLAYGROUND.releases.before,
};

/** The recorded examples for one goal in one disguise (harmless: that disguise's harmless twins). */
export function cellPool(goal: ArenaGoalId, disguise: ArenaDisguiseId): PlayExample[] {
  if (goal === 'harmless') return PLAYGROUND.harmless[disguise]?.examples ?? [];
  return PLAYGROUND.cells[`${goal}:${disguise}`]?.examples ?? [];
}

/** That release's own recorded verdict; null when the October model was not scored on this text. */
export function verdictFor(ex: PlayExample, release: Release) {
  return release === 'now' ? ex.now : ex.before;
}

/* ------------------------------------------------------------ the gauntlet: every recorded case */

export type GauntletCase = { example: PlayExample; goal: ArenaGoalId; disguise: ArenaDisguiseId; harmless: boolean };

const ATTACK_GOALS = ARENA_GOALS.filter((g) => g.id !== 'harmless').map((g) => g.id);

export const GAUNTLET: GauntletCase[] = [
  ...ATTACK_GOALS.flatMap((goal) =>
    ARENA_DISGUISES.flatMap((d) => cellPool(goal, d.id).map((example) => ({ example, goal, disguise: d.id, harmless: false }))),
  ),
  ...ARENA_DISGUISES.flatMap((d) =>
    cellPool('harmless', d.id).map((example) => ({ example, goal: 'harmless' as const, disguise: d.id, harmless: true })),
  ),
];

/** Score one release on the 75 recorded cases, from its own verdicts. Unscored cases are counted apart. */
export function scoreGauntlet(release: Release) {
  let stopped = 0, attacks = 0, falseAlarms = 0, harmless = 0, unscored = 0;
  const ms: number[] = [];
  for (const c of GAUNTLET) {
    const v = verdictFor(c.example, release);
    if (!v) { unscored++; continue; }
    if (v.ms) ms.push(v.ms);
    if (c.harmless) { harmless++; if (v.blocked) falseAlarms++; }
    else { attacks++; if (v.blocked) stopped++; }
  }
  ms.sort((a, b) => a - b);
  return { stopped, attacks, falseAlarms, harmless, unscored, medianMs: ms.length ? ms[ms.length >> 1] : null };
}

/* ------------------------------------------------------------ full red-team suite, by disguise */

type Family = (typeof PLAYGROUND.families)[string];
function sum(pick: (f: Family) => [number, number] | null): [number, number] {
  let a = 0, b = 0;
  for (const f of Object.values(PLAYGROUND.families)) {
    const c = pick(f);
    if (c) { a += c[0]; b += c[1]; }
  }
  return [a, b];
}

export const SUITE = {
  now: (() => { const c = sum((f) => f.caught.now), w = sum((f) => f.wronglyBlocked.now); return { caught: c[0], attacks: c[1], wronglyBlocked: w[0], harmless: w[1] }; })(),
  before: (() => { const c = sum((f) => f.caught.before), w = sum((f) => f.wronglyBlocked.before); return { caught: c[0], attacks: c[1], wronglyBlocked: w[0], harmless: w[1] }; })(),
};

export const FAMILIES = ARENA_DISGUISES.map((d) => ({ ...d, ...PLAYGROUND.families[d.id] }));
