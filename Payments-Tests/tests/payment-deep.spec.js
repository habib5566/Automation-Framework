const { test, expect } = require('@playwright/test');
const { VIEWPORTS, CORE_CHECKS } = require('../data/payment-checks');

/**
 * 22 core checks × 3 viewports = 66 test cases (same behaviour at different sizes).
 */
for (const vp of VIEWPORTS) {
  test.describe(`Payments module @ ${vp.label} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await page.goto('/crm-pay/admin/payment', { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('load').catch(() => {});
    });

    for (const check of CORE_CHECKS) {
      test(`${check.id} [${vp.label}]: ${check.title}`, async ({ page }, testInfo) => {
        testInfo.annotations.push({ type: 'expected', description: check.title });
        await check.run(page, expect);
      });
    }
  });
}
