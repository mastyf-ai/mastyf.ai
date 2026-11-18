import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PX_RESULTS } from '@/app/attack-lab/data';

const root = process.cwd();
const read = (name: string) => readFileSync(join(root, name), 'utf8');

describe('the Protocol X page', () => {
  it('has its own tab in the navigation, right after Platform', () => {
    expect(read('components/SiteNav.tsx')).toMatch(
      /\{ href: '\/platform', label: 'Platform' \},\s*\{ href: '\/protocol-x', label: 'Protocol X' \},/,
    );
  });

  it('lets visitors try it: the interactive playground with recorded verdicts', () => {
    const page = read('app/protocol-x/page.tsx');
    expect(page).toContain('<Playground />');
    expect(page).toMatch(/recorded/i);
    expect(page).toContain('href="/pricing"');
    expect(page).toContain('href="/attack-lab"');
  });

  it('shows the same measured results as the Attack Lab, from one place', () => {
    expect(PX_RESULTS.agentdojo).toEqual({ before: '25%', after: '0%', cases: 249 });
    expect(PX_RESULTS.novelAttacks).toBe(777);
    for (const page of ['app/protocol-x/page.tsx', 'app/attack-lab/page.tsx']) {
      expect(read(page)).toContain('PX_RESULTS');
    }
  });

  it('says plainly what it does today: blocks poisoned results, records on tool calls', () => {
    const page = read('app/protocol-x/page.tsx');
    expect(page).toMatch(/block/i);
    expect(page).toMatch(/flag|record/i);
  });

  it('removes the tabs from the home page hero', () => {
    expect(read('components/landing/HeroSection.tsx')).not.toContain('HeroTabs');
    expect(existsSync(join(root, 'components/landing/HeroTabs.tsx'))).toBe(false);
  });
});
