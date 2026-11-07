import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatedDownloadBox } from '../components/download/GatedDownloadBox';
import { ShieldDownloadButtons } from '../components/download/ShieldDownloadButtons';

const box = (entitled: boolean, signedIn: boolean) =>
  renderToStaticMarkup(createElement(GatedDownloadBox, { entitled, signedIn, checkoutUrl: '/pricing' }));

describe('Shield download UI', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SHIELD_PLATFORMS', 'windows'));
  afterEach(() => vi.unstubAllEnvs());

  it('gives a subscriber plain download links with no key in them', () => {
    const html = box(true, true);
    expect(html).toContain('href="/api/v1/download/shield?os=windows&amp;arch=x64"');
    // Windows is the installer only.
    expect(html).not.toContain('arch=zip');
    expect(html).not.toContain('.zip');
    expect(html).not.toContain('key=');
  });

  it('asks a signed-out visitor to sign in, with no download link', () => {
    const html = box(false, false);
    expect(html).toContain('Sign in to download');
    expect(html).toContain('/login?callbackUrl=%2Fdownload');
    expect(html).not.toContain('/api/v1/download/shield');
  });

  it('sends a signed-in visitor without a plan to buy one', () => {
    const html = box(false, true);
    expect(html).toContain('Get a plan to download');
    expect(html).not.toContain('/api/v1/download/shield');
  });

  it('lists platforms without a build as coming soon on the dashboard', () => {
    const html = renderToStaticMarkup(createElement(ShieldDownloadButtons));
    expect(html).toContain('href="/api/v1/download/shield?os=windows&amp;arch=x64"');
    expect(html).not.toContain('os=mac');
    expect(html).not.toContain('os=linux');
    expect(html.match(/Coming soon/g)?.length).toBe(2);
  });
});
