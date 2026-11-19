import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKETPLACES } from '@/lib/marketplaces';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('marketplace listings', () => {
  it('lists every live listing with its exact public URL', () => {
    const byName = Object.fromEntries(MARKETPLACES.map((m) => [m.name, m.href]));
    expect(byName['VS Code Marketplace']).toBe(
      'https://marketplace.visualstudio.com/items?itemName=MastyfLabs.mastyf-shield',
    );
    expect(byName['Open VSX']).toBe('https://open-vsx.org/extension/MastyfLabs/mastyf-shield');
    expect(byName['PyPI']).toBe('https://pypi.org/project/mastyf-ai/');
    expect(byName['GitHub']).toBe('https://github.com/mastyf-ai/mastyf.ai');
  });

  it('does not link npm while the package is not published', () => {
    expect(MARKETPLACES.some((m) => /npmjs/.test(m.href))).toBe(false);
  });

  it('every listing is https and says what you get there', () => {
    for (const m of MARKETPLACES) {
      expect(m.href.startsWith('https://')).toBe(true);
      expect(m.what.length).toBeGreaterThan(5);
    }
  });

  it('the footer has a "Get Mastyf" column fed by the shared list', () => {
    const footer = read('components/SiteFooter.tsx');
    expect(footer).toContain("title: 'Get Mastyf'");
    expect(footer).toContain('MARKETPLACES');
  });

  it('the download page links every listing', () => {
    const page = read('app/download/page.tsx');
    expect(page).toContain('MARKETPLACES.map');
  });
});
