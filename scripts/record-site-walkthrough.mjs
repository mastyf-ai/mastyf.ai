#!/usr/bin/env node
/**
 * Record a WebM walkthrough of mastyf.ai: landing → certified lookup → live score.
 *
 * Usage:
 *   BASE_URL=https://mastyf-ai-cloud-jet.vercel.app pnpm tutorial:record-site
 *   BASE_URL=http://localhost:3001 TUTORIAL_PACKAGE=@playwright/mcp pnpm tutorial:record-site
 *
 * Output: docs/tutorials/videos/site-walkthrough-demo.webm
 *         apps/cloud/public/tutorials/site-walkthrough-demo.webm (for deploy)
 */
import { mkdirSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs/tutorials/videos');
const PUBLIC_DIR = join(ROOT, 'apps/cloud/public/tutorials');
const BASE_URL = (process.env.BASE_URL || 'https://mastyf-ai-cloud-jet.vercel.app').replace(/\/$/, '');
const PACKAGE = process.env.TUTORIAL_PACKAGE || '@playwright/mcp';
const ENCODED_PKG = encodeURIComponent(PACKAGE);
const OUT_NAME = process.env.TUTORIAL_OUT_NAME || 'site-walkthrough-demo.webm';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(PUBLIC_DIR, { recursive: true });

  const probe = spawnSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', `${BASE_URL}/`], {
    encoding: 'utf-8',
  });
  const code = probe.stdout?.trim();
  if (code !== '200') {
    console.error(`ERROR: ${BASE_URL}/ returned HTTP ${code || 'failed'}`);
    process.exit(1);
  }

  console.log(`Recording site walkthrough against ${BASE_URL} …`);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  try {
    // Scene 1 — Landing hero
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await sleep(2500);

    // Scene 2 — Architecture section
    const archLink = page.locator('a[href="#architecture"]').first();
    if (await archLink.count()) {
      await archLink.click();
      await sleep(2000);
      await page.evaluate(() => window.scrollBy(0, 400));
      await sleep(2000);
    }

    // Scene 3 — Security scores / certified
    await page.goto(`${BASE_URL}/certified`, { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    const input = page.locator('#badge-pkg');
    await input.waitFor({ state: 'visible' });
    await input.click();
    await input.fill('');
    await sleep(400);
    // Type slowly so viewers see live lookup
    for (const ch of PACKAGE) {
      await input.type(ch, { delay: 80 });
    }
    await sleep(2000);

    const preview = page.locator('.socket-search-preview img');
    if (await preview.count()) {
      await preview.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await sleep(2500);
    }

    const viewScore = page.getByRole('link', { name: 'View score' });
    if (await viewScore.isEnabled()) {
      await viewScore.click();
      await page.waitForURL(/\/certified\//, { timeout: 30000 });
      await sleep(3000);
      await page.evaluate(() => window.scrollBy(0, 280));
      await sleep(2000);
      await page.evaluate(() => window.scrollBy(0, 320));
      await sleep(2000);
    }

    // Scene 4 — JSON API (browser tab)
    await page.goto(`${BASE_URL}/api/v1/badge/${ENCODED_PKG}/json`, { waitUntil: 'domcontentloaded' });
    await sleep(3000);

    // Scene 5 — Back to certified CTA
    await page.goto(`${BASE_URL}/certified`, { waitUntil: 'domcontentloaded' });
    await sleep(1500);
  } catch (err) {
    console.warn('Recording continued with partial flow:', err instanceof Error ? err.message : err);
  }

  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();

  if (video) {
    const rawPath = await video.path();
    const dest = join(OUT_DIR, OUT_NAME);
    if (existsSync(rawPath)) {
      renameSync(rawPath, dest);
      copyFileSync(dest, join(PUBLIC_DIR, OUT_NAME));
      console.log(`Saved: ${dest}`);
      console.log(`Copied: ${join(PUBLIC_DIR, OUT_NAME)}`);
    }
  } else {
    console.log(`Check ${OUT_DIR} for recorded WebM`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
