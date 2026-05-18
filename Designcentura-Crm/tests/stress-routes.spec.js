const { test, expect } = require('@playwright/test');
const { ADMIN_ROUTES } = require('../utils/routes');

/**
 * Sequential stress: full route cycles. Not a replacement for k6/Gatling.
 * STRESS_LOOPS default 5, max 30 — be careful on production.
 */
const LOOPS = Math.min(Math.max(Number(process.env.STRESS_LOOPS || 5), 1), 30);

test.describe('CRM admin — repeat navigation (light stress)', () => {
  test(`STRESS-001: cycle all admin routes ${LOOPS} times`, async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'expected',
      description: `Each of ${ADMIN_ROUTES.length} routes opens successfully ${LOOPS} times; URL stable; status < 400.`,
    });

    for (let i = 0; i < LOOPS; i += 1) {
      for (const route of ADMIN_ROUTES) {
        const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
        if (response) {
          expect(response.status(), `${route.name} loop ${i + 1}`).toBeLessThan(400);
        }
        await expect(page).toHaveURL(new RegExp(route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    }
  });
});
