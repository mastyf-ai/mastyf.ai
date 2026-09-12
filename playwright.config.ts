import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 5.5 — Shield KPI canary (optional live stack).
 * Run: MASTYF_LIVE=1 npx playwright test
 * Skips when SPA/BFF are down unless MASTYF_LIVE=1.
 */
export default defineConfig({
  testDir: 'tests/e2e-ui',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.MASTYF_SPA_URL || 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
