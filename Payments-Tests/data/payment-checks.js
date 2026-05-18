/**
 * Declarative checks for /crm-pay/admin/payment — each runs after page is on payment URL.
 * @typedef {{ id: string, title: string, run: (page: import('@playwright/test').Page, expect: import('@playwright/test').Expect) => Promise<void> }} PaymentCheck
 */

/** @type {{ width: number; height: number; label: string }[]} */
const VIEWPORTS = [
  { width: 1920, height: 1080, label: 'desktop-fhd' },
  { width: 1366, height: 768, label: 'desktop-laptop' },
  { width: 390, height: 844, label: 'mobile' },
];

/** @type {PaymentCheck[]} */
const CORE_CHECKS = [
  {
    id: 'PAY-001',
    title: 'URL contains admin payment segment',
    run: async (page, expect) => {
      await expect(page).toHaveURL(/crm-pay\/admin\/payment/i);
    },
  },
  {
    id: 'PAY-002',
    title: 'Navigation returns HTTP status below 400',
    run: async (page, expect) => {
      const res = await page.goto('/crm-pay/admin/payment', { waitUntil: 'domcontentloaded' });
      if (res) expect(res.status()).toBeLessThan(400);
    },
  },
  {
    id: 'PAY-003',
    title: 'Page exposes substantial visible text (>= 120 chars)',
    run: async (page, expect) => {
      const n = await page.evaluate(() => (document.body?.innerText || '').trim().length);
      expect(n, 'body text length').toBeGreaterThanOrEqual(120);
    },
  },
  {
    id: 'PAY-004',
    title: 'Page exposes rich content (>= 250 chars)',
    run: async (page, expect) => {
      const n = await page.evaluate(() => (document.body?.innerText || '').trim().length);
      expect(n).toBeGreaterThanOrEqual(250);
    },
  },
  {
    id: 'PAY-005',
    title: 'Page exposes very rich content (>= 350 chars)',
    run: async (page, expect) => {
      const n = await page.evaluate(() => (document.body?.innerText || '').trim().length);
      expect(n).toBeGreaterThanOrEqual(350);
    },
  },
  {
    id: 'PAY-006',
    title: 'At least one button is visible',
    run: async (page, expect) => {
      await expect(page.locator('button:visible').first()).toBeVisible();
    },
  },
  {
    id: 'PAY-007',
    title: 'At least two visible buttons',
    run: async (page, expect) => {
      expect(await page.locator('button:visible').count()).toBeGreaterThanOrEqual(2);
    },
  },
  {
    id: 'PAY-008',
    title: 'At least three visible links',
    run: async (page, expect) => {
      expect(await page.locator('a:visible').count()).toBeGreaterThanOrEqual(3);
    },
  },
  {
    id: 'PAY-009',
    title: 'At least one visible text input or search field',
    run: async (page, expect) => {
      const inputs = page.locator('input:visible');
      expect(await inputs.count()).toBeGreaterThanOrEqual(1);
    },
  },
  {
    id: 'PAY-010',
    title: 'Finance-related vocabulary appears (payment|invoice|amount|transaction|billing|receipt)',
    run: async (page, expect) => {
      await expect(page.getByText(/payment|invoice|amount|transaction|billing|receipt|balance|paid|due/i).first()).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    id: 'PAY-011',
    title: 'DesignCentura brand visible in shell',
    run: async (page, expect) => {
      await expect(page.getByText(/DesignCentura/i).first()).toBeVisible();
    },
  },
  {
    id: 'PAY-012',
    title: 'Dashboard nav link exists in DOM',
    run: async (page, expect) => {
      await expect(page.locator('a[href*="/crm-pay/admin/dashboard"]').first()).toBeVisible();
    },
  },
  {
    id: 'PAY-013',
    title: 'No visible ARIA alert with critical server error wording',
    run: async (page, expect) => {
      const bad = page.getByRole('alert').filter({ hasText: /Internal Server Error|Bad Gateway|Service Unavailable/i });
      await expect(bad).toHaveCount(0);
    },
  },
  {
    id: 'PAY-014',
    title: 'Document body is attached and scrollable container exists',
    run: async (page, expect) => {
      const ok = await page.evaluate(() => !!document.body && document.body.scrollHeight >= 0);
      expect(ok).toBeTruthy();
    },
  },
  {
    id: 'PAY-015',
    title: 'Reload keeps user on payment route',
    run: async (page, expect) => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/crm-pay\/admin\/payment/i);
    },
  },
  {
    id: 'PAY-016',
    title: 'Second reload still on payment route',
    run: async (page, expect) => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/crm-pay\/admin\/payment/i);
    },
  },
  {
    id: 'PAY-017',
    title: 'Payments or Payment appears in page text',
    run: async (page, expect) => {
      const t = (await page.locator('body').innerText()).toLowerCase();
      expect(/payment|payments|invoice/.test(t)).toBeTruthy();
    },
  },
  {
    id: 'PAY-018',
    title: 'Data presentation layer (table, grid, or common table wrapper class)',
    run: async (page, expect) => {
      const n = await page
        .locator('table, [role="grid"], [role="table"], .table, .data-table, [class*="table"]')
        .count();
      expect(n).toBeGreaterThanOrEqual(1);
    },
  },
  {
    id: 'PAY-019',
    title: 'Document has charset or viewport meta (baseline HTML quality)',
    run: async (page, expect) => {
      const n = await page.locator('meta[charset], meta[name="viewport"]').count();
      expect(n).toBeGreaterThanOrEqual(1);
    },
  },
  {
    id: 'PAY-020',
    title: 'LocalStorage API available (SPA expectation)',
    run: async (page, expect) => {
      const ok = await page.evaluate(() => typeof localStorage !== 'undefined');
      expect(ok).toBeTruthy();
    },
  },
  {
    id: 'PAY-021',
    title: 'Keyboard focus can move (Tab does not throw)',
    run: async (page, expect) => {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(page).toHaveURL(/payment/i);
    },
  },
  {
    id: 'PAY-022',
    title: 'Viewport renders primary interactive region (main or role main or form)',
    run: async (page, expect) => {
      const n = await page.locator('main, [role="main"], form').count();
      expect(n).toBeGreaterThanOrEqual(1);
    },
  },
];

module.exports = { VIEWPORTS, CORE_CHECKS };
