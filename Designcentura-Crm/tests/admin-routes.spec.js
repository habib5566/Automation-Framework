const { test, expect } = require('@playwright/test');
const { ADMIN_ROUTES } = require('../utils/routes');

function annotateExpected(info, text) {
  info.annotations.push({ type: 'expected', description: text });
}

test.describe('CRM admin — route regression (read-only checks)', () => {
  for (const route of ADMIN_ROUTES) {
    test(`${route.id}: ${route.name} — page loads and URL is correct`, async ({ page }, testInfo) => {
      annotateExpected(
        testInfo,
        `Navigate to ${route.path}; expect HTTP < 400, URL matches route, substantial page text (logged-in shell).`
      );

      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });

      await expect(page).toHaveURL(new RegExp(route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

      if (response) {
        expect(
          response.status(),
          `Expected HTTP < 400 for ${route.name}; got ${response.status()} (server or auth issue).`
        ).toBeLessThan(400);
      }

      await page.waitForLoadState('load').catch(() => {});

      const textLen = await page.evaluate(() => {
        const t = document.body?.innerText?.trim() ?? '';
        return t.length;
      });
      expect(textLen, 'Page should render meaningful text (SPA shell).').toBeGreaterThan(50);
    });
  }
});
