import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (name: string) => readFileSync(join(process.cwd(), name), 'utf8');
const [dark, light] = file('app/design/tokens.css').split(":root[data-theme='light']");

describe('the website’s colours match the app (dark: black frame, soft gold accent)', () => {
  it.each([
    ['--bg', '#0a0a0b'],
    ['--surface', '#151518'],
    ['--line', '#26262a'],
    ['--accent', '#b49a5e'],
    ['--accent-hover', '#c4ab70'],
    ['--accent-ink', '#0a0a0b'],
    ['--frame-bg', '#0d0d0f'],
    ['--frame-ink', '#ededea'],
  ])('dark: %s is %s', (name, value) => {
    expect(dark).toContain(`${name}: ${value};`);
  });

  it.each([
    ['--bg', '#f7f2ec'],
    ['--surface', '#ffffff'],
    ['--line', '#eee5d9'],
    ['--accent', '#603d20'],
    ['--accent-hover', '#4a2e17'],
    ['--accent-ink', '#ffffff'],
    ['--frame-bg', '#e4d7c5'],
    ['--frame-ink', '#2b1f14'],
  ])('light: %s is %s', (name, value) => {
    expect(light).toContain(`${name}: ${value};`);
  });

  it('has no bright yellow left in the dark theme or the preloader', () => {
    for (const text of [dark, file('app/design/preloader.css')]) {
      expect(text.toLowerCase()).not.toMatch(/#e5cb6c|#edd98e|229, 203, 108/);
    }
  });

  it('keeps the logo light on the black frame in dark mode (inverted only in the light theme)', () => {
    const shell = file('app/design/shell.css');
    expect(shell).toContain(":root[data-theme='light'] .brand-mark");
    expect(shell).not.toMatch(/^\.(nav__bar|nav__face|app__side) \.brand-mark/m);
  });

  it('puts the navbar and dashboard sidebar on the app’s frame colour', () => {
    expect(file('app/design/shell.css')).toMatch(/\.nav__bar \{[^}]*background: var\(--frame-bg\)/);
    expect(file('app/design/app.css')).toMatch(/\.app__side \{[^}]*background: var\(--frame-bg\)/);
  });
});
