const { test, expect } = require('@playwright/test');
const { ADMIN_ROUTES } = require('../utils/routes');

const BURST = Math.min(Math.max(Number(process.env.STRESS_BURST || 12), 3), 40);

test.describe('CRM admin — stress (concurrent + burst)', () => {
  test('STRESS-002: two different admin URLs in parallel (same session)', async ({ context }, testInfo) => {
    testInfo.annotations.push({
      type: 'expected',
      description:
        'Two tabs open different admin routes concurrently; both return HTTP < 400 when response exists.',
    });

    const p1 = await context.newPage();
    const p2 = await context.newPage();
    try {
      const [r1, r2] = await Promise.all([
        p1.goto('/crm-pay/admin/dashboard', { waitUntil: 'domcontentloaded' }),
        p2.goto('/crm-pay/admin/payment', { waitUntil: 'domcontentloaded' }),
      ]);
      if (r1) expect(r1.status()).toBeLessThan(400);
      if (r2) expect(r2.status()).toBeLessThan(400);
      await expect(p1).toHaveURL(/dashboard/);
      await expect(p2).toHaveURL(/payment/);
    } finally {
      await p1.close();
      await p2.close();
    }
  });

  test(`STRESS-003: burst reload dashboard ${BURST} times`, async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'expected',
      description: `Dashboard route tolerates rapid sequential navigations (${BURST}) without HTTP 5xx.`,
    });

    for (let i = 0; i < BURST; i += 1) {
      const response = await page.goto('/crm-pay/admin/dashboard', { waitUntil: 'commit' });
      if (response) {
        expect(response.status(), `burst ${i + 1}`).toBeLessThan(500);
      }
    }
    await expect(page).toHaveURL(/dashboard/);
  });

  test('STRESS-004: fan-out first N routes in parallel', async ({ context }, testInfo) => {
    const n = Math.min(4, ADMIN_ROUTES.length);
    testInfo.annotations.push({
      type: 'expected',
      description: `Open first ${n} admin routes at once in separate tabs; all HTTP < 400 if response exists.`,
    });

    const pages = await Promise.all(Array.from({ length: n }, () => context.newPage()));
    try {
      const results = await Promise.all(
        pages.map((pg, i) => pg.goto(ADMIN_ROUTES[i].path, { waitUntil: 'domcontentloaded' }))
      );
      results.forEach((res, i) => {
        if (res) expect(res.status(), ADMIN_ROUTES[i].name).toBeLessThan(400);
      });
    } finally {
      await Promise.all(pages.map((pg) => pg.close()));
    }
  });
});
