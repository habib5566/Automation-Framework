const { test, expect } = require('@playwright/test');

/** Cross-route flows on top of the 66 viewport matrix (total 70+ cases). */
test.describe('Payments — cross-route flows', () => {
  test('PAY-X-01: dashboard → payment → dashboard → payment', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'expected',
      description: 'User can switch between dashboard and payment without losing auth.',
    });
    await page.goto('/crm-pay/admin/payment', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/payment/i);
    await page.goto('/crm-pay/admin/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/dashboard/i);
    await page.goto('/crm-pay/admin/payment', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/payment/i);
  });

  test('PAY-X-02: hard reload on payment preserves URL', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'expected', description: 'Hard reload stays on payment.' });
    await page.goto('/crm-pay/admin/payment', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/crm-pay\/admin\/payment/i);
  });

  test('PAY-X-03: payment page exposes same host (no unexpected redirect host)', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'expected', description: 'Stay on designcentura.com' });
    await page.goto('/crm-pay/admin/payment', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).hostname).toContain('designcentura.com');
  });

  test('PAY-X-04: sequential payment loads (3) remain stable', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'expected',
      description: 'Three sequential navigations to payment all succeed with URL match.',
    });
    for (let i = 0; i < 3; i += 1) {
      await page.goto('/crm-pay/admin/payment', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/crm-pay\/admin\/payment/i);
    }
  });
});
