import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

const root = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) return sources(rel);
    return /\.(tsx?|mdx?)$/.test(name) ? [rel] : [];
  });
}

describe('the deprecated Platform page is gone', () => {
  it('has no page any more', () => {
    expect(existsSync(join(root, 'app/platform'))).toBe(false);
  });

  it('nothing on the site links to it', () => {
    const offenders = [...sources('app'), ...sources('components')].filter((f) =>
      /['"`]\/platform(?:[#'"`?/])/.test(readFileSync(join(root, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('old links land on How enforcement works instead of a 404', async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects).toContainEqual(
      expect.objectContaining({ source: '/platform', destination: '/docs/how-it-works', permanent: true }),
    );
  });
});
