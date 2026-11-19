import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKS_WITH } from '@/lib/works-with';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('"Works with" ribbon', () => {
  it('names the seven integrations in order', () => {
    expect(WORKS_WITH.map((w) => w.name)).toEqual([
      'Claude Code',
      'Cursor',
      'VS Code',
      'GitHub Copilot',
      'LangChain',
      'OpenAI Agents',
      'Mastra',
    ]);
  });

  it('every logo file exists in public/ and is an SVG', () => {
    for (const w of WORKS_WITH) {
      const file = join(root, 'public', w.logo);
      expect(existsSync(file), w.logo).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('<svg');
    }
  });

  it('every item links to the docs section that shows how to connect it', () => {
    for (const w of WORKS_WITH) expect(w.href).toMatch(/^\/docs\/connect#[a-z-]+$/);
  });

  it('sits directly below the hero on the home page', () => {
    const page = read('app/page.tsx');
    const hero = page.indexOf('<HeroSection');
    const ribbon = page.indexOf('<WorksWithRibbon');
    const next = page.indexOf('<ProtocolXSim');
    expect(hero).toBeGreaterThan(-1);
    expect(ribbon).toBeGreaterThan(hero);
    expect(ribbon).toBeLessThan(next);
  });

  it('says "works with", never compliance or partnership', () => {
    const src = read('components/landing/WorksWithRibbon.tsx');
    expect(src).toContain('Works with');
    expect(src).not.toMatch(/complian|certified|partner|endorse/i);
  });
});
