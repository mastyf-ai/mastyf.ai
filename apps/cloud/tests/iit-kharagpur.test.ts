import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IIT_KGP } from '@/lib/iit-kharagpur';

const read = (name: string) => readFileSync(join(process.cwd(), name), 'utf8');

describe('the IIT Kharagpur page', () => {
  it('states the award as the letter does', () => {
    expect(IIT_KGP.scheme).toBe('IIT Kharagpur Seed Fund Scheme');
    expect(IIT_KGP.amount).toBe('₹15,00,000');
    expect(IIT_KGP.awarded).toBe('14 October 2026');
    expect(IIT_KGP.reference).toBe('IITKGP/Seed/2026/1/11');
  });

  it('leaves out private deal terms and personal contact details', () => {
    const page = read('app/iit-kharagpur/page.tsx') + read('lib/iit-kharagpur.ts');
    for (const secret of ['3%', '2%', '7,500', 'moratorium', 'Mondal', 'Nandi']) {
      expect(page.toLowerCase(), secret).not.toContain(secret.toLowerCase());
    }
    expect(page).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // no email addresses
  });

  it('has a tab in the navigation and a link in the footer', () => {
    expect(read('components/SiteNav.tsx')).toContain("{ href: '/iit-kharagpur', label: 'IIT KGP' }");
    expect(read('components/SiteFooter.tsx')).toContain("href: '/iit-kharagpur'");
  });
});
