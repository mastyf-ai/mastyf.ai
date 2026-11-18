import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAPERS, PAPER_PDF_URL, ZENODO_DOI, ZENODO_URL } from '@/lib/product-links';

const root = process.cwd();
const read = (name: string) => readFileSync(join(root, name), 'utf8');

describe('the research page', () => {
  it('cites the newest Zenodo version of the paper (record 22895043), not the old 22501491', () => {
    expect(ZENODO_URL).toBe('https://zenodo.org/records/22895043');
    expect(ZENODO_DOI).toBe('10.5281/zenodo.22895043');
    expect(PAPER_PDF_URL).toContain('/records/22895043/files/mastyf_guard_1.5B.pdf');
    for (const dir of ['app', 'components', 'lib']) {
      const hits = (readdirSync(join(root, dir), { recursive: true }) as string[])
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .filter((f) => read(join(dir, f)).includes('22501491'));
      expect(hits, `${dir} still cites the old record`).toEqual([]);
    }
  });

  it('shows every page of the new version in the reader window', () => {
    const pages = readdirSync(join(root, 'public/paper/pages')).filter((f) => /^page-\d\d\.webp$/.test(f));
    expect(pages).toHaveLength(42);
    expect(read('components/research/PaperReader.tsx')).toContain('const PAGE_COUNT = 42;');
    expect(existsSync(join(root, 'public/paper/mastyf-guard.pdf'))).toBe(true);
  });

  it("lists both of the founder's Mastyf papers, each with a working DOI", () => {
    const titles = PAPERS.map((p) => p.title);
    expect(titles).toContain('Capability-Mediated Perimeters for Secure AI Agent Tool Execution');
    expect(titles).toContain(
      'Mastyf Guard 1.5B: Cognitive Harvard Architectures for Sub-Millisecond AI Agent Perimeter Defense and Capability-Based Access Control',
    );
    for (const p of PAPERS) {
      expect(p.links.length).toBeGreaterThan(0);
      for (const l of p.links) expect(l.href).toMatch(/^https:\/\//);
    }
    expect(PAPERS.find((p) => p.title.startsWith('Mastyf Guard'))!.links.map((l) => l.href)).toContain(
      'https://doi.org/10.21203/rs.3.rs-10868139/v1',
    );
    expect(read('app/research/page.tsx')).toContain('PAPERS.map');
  });
});
