import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('README', () => {
  const readme = readFileSync(join(pkg, 'README.md'), 'utf8');

  it('documents every command', () => {
    for (const c of ['serve', 'proxy', 'test', 'init-copilot', 'copilot-hook']) expect(readme, c).toContain(`mastyf-check ${c}`);
  });

  it("says what Copilot users need to know, including the limits", () => {
    expect(readme).toContain('## GitHub Copilot');
    expect(readme).toContain('.github/hooks/mastyf.json');
    expect(readme).toMatch(/session log/i);
    expect(readme).toMatch(/not yet .*live Copilot session|tried in a live Copilot session/i);
    expect(readme).toContain('nothing is sent to Mastyf');
    expect(readme).toContain('AGPL-3.0');
  });

  it('is in the published files', () => {
    const p = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    expect(p.files).toContain('README.md');
  });
});
