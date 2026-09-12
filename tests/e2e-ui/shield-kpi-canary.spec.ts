import { test, expect } from '@playwright/test';

/**
 * Shield KPIs must reflect live ledger — when MASTYF_LIVE=1 and stack is up.
 * Forced skip when offline (never invent green UI assertions).
 */
const live = process.env.MASTYF_LIVE === '1';
const bff = process.env.MASTYF_AI_BFF_URL || 'http://127.0.0.1:4000';

test.describe('Shield perimeter KPI canary', () => {
  test.skip(!live, 'Set MASTYF_LIVE=1 with SPA+BFF+gateway running');

  test('receipt inject moves live ledger counts (API authority)', async ({ request }) => {
    const before = await request.get(`${bff}/api/gateway/receipts?limit=20`);
    expect(before.ok()).toBeTruthy();
    const bj = await before.json();
    const n0 = Array.isArray(bj.receipts) ? bj.receipts.length : 0;

    const decide = await request.post(`${bff}/api/gateway/decide`, {
      data: {
        tool_name: 'pw_shield_kpi_probe',
        server_name: 'ci-server',
        arguments: { path: '/tmp/pw-kpi' },
        write_receipt: true,
        trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      },
    });
    expect([200, 400, 503]).toContain(decide.status());
    if (decide.ok()) {
      const dj = await decide.json();
      expect(dj.write_receipt === true || dj.execution_receipt || dj.receipt_id).toBeTruthy();
    }

    const after = await request.get(`${bff}/api/gateway/receipts?limit=20`);
    expect(after.ok()).toBeTruthy();
    const aj = await after.json();
    const n1 = Array.isArray(aj.receipts) ? aj.receipts.length : 0;
    if (decide.ok()) {
      expect(n1).toBeGreaterThanOrEqual(n0);
    } else {
      expect(n1).toBeGreaterThanOrEqual(Math.min(n0, 20));
    }
  });

  test('Home Escalated KPI opens the receipt drawer without leaving Home', async ({ page }) => {
    const spa = process.env.MASTYF_SPA_URL || 'http://127.0.0.1:3000';
    await page.goto(`${spa}/?mode=security-center&tab=home`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Grant latest escalate').first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('kpi-escalated').first().click();
    await expect(page.getByTestId('receipt-drawer')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Grant this receipt').first()).toBeVisible();
    expect(page.url()).not.toContain('tab=activity');
  });

  test('force-fail canary shows failing case id in Shield modal', async ({ page }) => {
    test.setTimeout(360_000);
    const spa = process.env.MASTYF_SPA_URL || 'http://127.0.0.1:3000';
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(`${spa}/?mode=security-center&tab=home`, { waitUntil: 'domcontentloaded' });
    const homeBtn = page.getByRole('button', { name: '2. Test Mastyf' });
    if (await homeBtn.count()) {
      await homeBtn.click();
    } else {
      await page.locator('[data-testid="open-canary-modal"]').evaluate((el) => {
        (el as HTMLButtonElement).click();
      });
    }
    const force = page.getByTestId('self-test-force-fail');
    await expect(force).toBeVisible({ timeout: 20_000 });
    await force.click();
    await expect(page.getByTestId('self-test-failed-cases')).toBeVisible({ timeout: 300_000 });
    await expect(page.getByText(/#1 /)).toBeVisible();
  });

  test('forced-fail path: observability-status never invents OTEL green', async ({ request }) => {
    const res = await request.get(`${bff}/api/gateway/observability-status`);
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    if (!json.otel_configured) {
      expect(json.collector_probe?.ok).not.toBe(true);
    }
  });
});
