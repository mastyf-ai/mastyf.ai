import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOUNDERS, initials } from '@/lib/founders';

const file = (name: string) => readFileSync(join(process.cwd(), name), 'utf8');

describe('the Founders page', () => {
  it('has a tab in the navigation and a link in the footer', () => {
    expect(file('components/SiteNav.tsx')).toContain("{ href: '/founders', label: 'Founders' }");
    expect(file('components/SiteFooter.tsx')).toContain("href: '/founders'");
  });

  it('gives every founder a name, a role and a bio', () => {
    expect(FOUNDERS.length).toBeGreaterThan(0);
    for (const f of FOUNDERS) {
      expect(f.name.trim()).not.toBe('');
      expect(f.role.trim()).not.toBe('');
      expect(f.bio.trim()).not.toBe('');
    }
  });

  it('shows initials when there is no photo', () => {
    expect(initials('Rudraneel Das')).toBe('RD');
    expect(initials('  koustav  manna  extra ')).toBe('KM');
  });
});
