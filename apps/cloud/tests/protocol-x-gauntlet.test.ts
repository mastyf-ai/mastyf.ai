import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARENA_DISGUISES,
  GAUNTLET,
  SUITE,
  cellPool,
  scoreGauntlet,
  verdictFor,
} from '@/app/protocol-x/arena-data';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('arena: goal × disguise × release', () => {
  it('offers the three recorded disguises', () => {
    expect(ARENA_DISGUISES.map((d) => d.id)).toEqual(['split-assembly', 'delayed-trigger', 'error-recovery']);
  });

  it('every goal and disguise has recorded examples, harmless twins included', () => {
    for (const g of ['prompt-injection', 'credential-exfil', 'cross-tool-chain', 'boundary-evasion', 'harmless'] as const)
      for (const d of ARENA_DISGUISES) expect(cellPool(g, d.id).length).toBe(5);
  });

  it('the October model is shown with its own recorded verdict, never the November one', () => {
    const ex = cellPool('credential-exfil', 'delayed-trigger')[1];
    expect(verdictFor(ex, 'now')?.blocked).toBe(true);
    expect(verdictFor(ex, 'before')?.blocked).toBe(false);
  });
});

describe('gauntlet: every recorded case, in one run', () => {
  it('holds all 60 attacks and 15 harmless twins', () => {
    expect(GAUNTLET.length).toBe(75);
    expect(GAUNTLET.filter((c) => c.harmless).length).toBe(15);
  });

  it('scores the November model from its recordings: 59 of 60 stopped, no false alarms', () => {
    expect(scoreGauntlet('now')).toMatchObject({ stopped: 59, attacks: 60, falseAlarms: 0, harmless: 15 });
  });

  it('scores the October model from its own recordings: it stopped fewer', () => {
    const before = scoreGauntlet('before');
    expect(before.stopped).toBe(53);
    expect(before.stopped).toBeLessThan(scoreGauntlet('now').stopped);
  });

  it('full-suite totals come from the recorded families, not from the 75 shown', () => {
    expect(SUITE.now).toEqual({ caught: 375, attacks: 387, wronglyBlocked: 0, harmless: 180 });
    expect(SUITE.before).toEqual({ caught: 330, attacks: 387, wronglyBlocked: 0, harmless: 180 });
  });
});

describe('Protocol X page', () => {
  it('says plainly that Protocol X is part of the paid tier', () => {
    const page = read('app/protocol-x/page.tsx');
    expect(page).toMatch(/Included in Mastyf Shield/);
    expect(page).toMatch(/not in the free tier/i);
    expect(page).toContain("formatPlanPrice('developer'");
    expect(page).toContain('href="/pricing"');
  });

  it('builds the page from the arena, the gauntlet and the disguise breakdown', () => {
    const page = read('app/protocol-x/page.tsx');
    for (const part of ['<PxArena', '<PxGauntlet', '<PxDisguises']) expect(page).toContain(part);
  });

  it('keeps every animated part reduced-motion safe', () => {
    for (const f of ['PxArena.tsx', 'PxGauntlet.tsx', 'PxDisguises.tsx']) expect(read(`app/protocol-x/${f}`)).toContain('useReducedMotion');
  });
});
