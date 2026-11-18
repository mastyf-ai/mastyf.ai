import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The hero tabs use hooks, which this node test setup can't render (it resolves two copies of React),
// so the source is checked here and the behaviour in a browser.
const read = (name: string) => readFileSync(join(process.cwd(), name), 'utf8');
const tabs = read('components/landing/HeroTabs.tsx');

describe('the hero tabs', () => {
  it('sit in the hero', () => {
    expect(read('components/landing/HeroSection.tsx')).toContain('<HeroTabs />');
  });

  it('offer "How Mastyf works" (open first) and "Try Protocol X" as an accessible tablist', () => {
    expect(tabs).toContain("{ id: 'how', label: 'How Mastyf works' }");
    expect(tabs).toContain("{ id: 'px', label: 'Try Protocol X' }");
    expect(tabs).toContain("useState<Tab>('how')");
    for (const attr of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-selected=', 'aria-controls=']) {
      expect(tabs).toContain(attr);
    }
  });

  it('say Protocol X is part of the paid Shield and its verdicts are recordings, and link to the Attack Lab', () => {
    expect(tabs).toMatch(/in Mastyf Shield/);
    expect(tabs).toMatch(/recorded run/);
    expect(tabs).toContain('href="/attack-lab"');
  });

  it('load the playground only when its tab is opened', () => {
    expect(tabs).toMatch(/lazy\(\(\) => import\('@\/app\/attack-lab\/Playground'\)/);
    expect(tabs).not.toMatch(/^import \{ Playground \}/m);
    expect(tabs).toContain("{tab === 'px' && (");
  });
});
