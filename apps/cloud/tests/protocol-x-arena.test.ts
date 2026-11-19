import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARENA_GOALS, arenaPool, nextThrow, splitPayload } from '@/app/protocol-x/arena-data';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Protocol X arena data', () => {
  it('offers the four attack goals plus a harmless call', () => {
    expect(ARENA_GOALS.map((g) => g.id)).toEqual([
      'prompt-injection',
      'credential-exfil',
      'cross-tool-chain',
      'boundary-evasion',
      'harmless',
    ]);
  });

  it('every pool is made only of recorded runs', () => {
    for (const g of ARENA_GOALS) {
      const pool = arenaPool(g.id);
      expect(pool.length).toBeGreaterThan(0);
      for (const ex of pool) {
        expect(typeof ex.now.p).toBe('number');
        expect(typeof ex.now.blocked).toBe('boolean');
      }
    }
  });

  it('harmless pool holds no hidden instruction; attack pools all do', () => {
    for (const ex of arenaPool('harmless')) expect(ex.hidden).toBeUndefined();
    for (const ex of arenaPool('credential-exfil')) expect(ex.hidden).toBeTruthy();
  });

  it('keeps the recorded miss: not every attack is shown as blocked', () => {
    const all = ARENA_GOALS.filter((g) => g.id !== 'harmless').flatMap((g) => arenaPool(g.id));
    expect(all.some((ex) => !ex.now.blocked)).toBe(true);
  });

  it('nextThrow walks the pool without repeating until it has shown them all', () => {
    const pool = arenaPool('prompt-injection');
    const seen = new Set<string>();
    let i = 0;
    for (let k = 0; k < pool.length; k++) {
      const t = nextThrow('prompt-injection', i);
      seen.add(t.example.id);
      i = t.next;
    }
    expect(seen.size).toBe(pool.length);
  });

  it('splitPayload marks the hidden instruction inside the payload', () => {
    const parts = splitPayload('abc HIDDEN xyz', 'HIDDEN');
    expect(parts).toEqual([
      { text: 'abc ', hidden: false },
      { text: 'HIDDEN', hidden: true },
      { text: ' xyz', hidden: false },
    ]);
    expect(splitPayload('plain', undefined)).toEqual([{ text: 'plain', hidden: false }]);
  });
});

describe('Protocol X page', () => {
  it('uses the arena and moves the long explanation to the docs', () => {
    const page = read('app/protocol-x/page.tsx');
    expect(page).toContain('<PxArena');
    expect(page).toContain('/docs/protocol-x');
    expect(page).not.toContain('<Playground');
    // Short page: no paragraph longer than ~120 characters of copy.
    const paragraphs = [...page.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
    for (const p of paragraphs) expect(p.length).toBeLessThan(120);
  });

  it('respects reduced motion', () => {
    expect(read('app/protocol-x/PxArena.tsx')).toContain('useReducedMotion');
    expect(read('app/protocol-x/protocol-x.css')).toContain('prefers-reduced-motion');
  });

  it('has a docs page with the details', () => {
    expect(existsSync(join(root, 'app/docs/protocol-x/page.tsx'))).toBe(true);
    const doc = read('app/docs/protocol-x/page.tsx');
    expect(doc).toMatch(/AgentDojo/);
    expect(doc).toMatch(/recorded/i);
  });
});
