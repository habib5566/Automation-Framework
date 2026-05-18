const { test, expect } = require('@playwright/test');
const { ADMIN_ROUTES } = require('../utils/routes');

/**
 * UI-level "unit" checks: small, isolated assertions per module (shell + nav brand),
 * not full business workflows.
 */
test.describe('CRM admin — UI unit checks (per route)', () => {
  for (const route of ADMIN_ROUTES) {
    test(`UNIT-UI-${route.id.replace('TC-ADM-', '')}: ${route.name} — shell & brand visible`, async ({
      page,
    }, testInfo) => {
      testInfo.annotations.push({
        type: 'expected',
        description: `After goto ${route.path}, URL matches and global shell shows DesignCentura / sidebar context.`,
      });

      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

      await expect(page.getByText(/DesignCentura/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('a[href*="/crm-pay/admin/dashboard"]').first()).toBeVisible({
        timeout: 15_000,
      });
    });
  }
});
