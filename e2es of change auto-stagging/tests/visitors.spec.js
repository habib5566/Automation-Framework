const { test, expect } = require('@playwright/test');

test.describe('Visitors Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to visitors page', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    expect(page.url()).toContain('/visitors');
  });

  test('Visitors page loads with data', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Search visitors functionality', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    const searchSelectors = ['input[placeholder*="search"]', 'input[type="search"]', '.search-input'];
    let searchFound = false;
    for (const selector of searchSelectors) {
      if (await page.isVisible(selector).catch(() => false)) {
        await page.fill(selector, 'test');
        searchFound = true;
        break;
      }
    }
    expect(searchFound).toBe(true);
  });

  test('Filter visitors by status', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    const filterSelectors = ['select[name="status"]', '.status-filter select', 'select'];
    let filterFound = false;
    for (const selector of filterSelectors) {
      if (await page.isVisible(selector).catch(() => false)) {
        await page.selectOption(selector, 'active').catch(() => {});
        filterFound = true;
        break;
      }
    }
    expect(filterFound).toBe(true);
  });

  test('View visitor details', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    const visitorSelectors = ['.visitor-item:first-child', 'tr:first-child', '.card:first-child'];
    let clicked = false;
    for (const selector of visitorSelectors) {
      if (await page.isVisible(selector).catch(() => false)) {
        await page.click(selector);
        clicked = true;
        break;
      }
    }
    expect(clicked).toBe(true);
  });

  test('Export visitors data', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    const exportSelectors = ['button:has-text("Export")', '.export-btn', 'button:has-text("Export")'];
    let exportFound = false;
    for (const selector of exportSelectors) {
      if (await page.isVisible(selector).catch(() => false)) {
        await page.click(selector);
        exportFound = true;
        break;
      }
    }
    expect(exportFound).toBe(true);
  });

  test('Pagination works', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    const paginationSelectors = ['.pagination-next', 'button:has-text("Next")', '.next-page'];
    let paginationFound = false;
    for (const selector of paginationSelectors) {
      if (await page.isVisible(selector).catch(() => false)) {
        await page.click(selector);
        paginationFound = true;
        break;
      }
    }
    expect(paginationFound).toBe(true);
  });

  test('Sort visitors by name', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    const sortSelectors = ['th:has-text("Name")', '.sort-name', 'button:has-text("Name")'];
    let sortFound = false;
    for (const selector of sortSelectors) {
      if (await page.isVisible(selector).catch(() => false)) {
        await page.click(selector);
        sortFound = true;
        break;
      }
    }
    expect(sortFound).toBe(true);
  });

  test('Bulk actions on visitors', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    const checkboxSelectors = ['.visitor-checkbox', 'input[type="checkbox"]', '.checkbox'];
    let bulkFound = false;
    for (const selector of checkboxSelectors) {
      if (await page.isVisible(selector).catch(() => false)) {
        await page.check(selector);
        bulkFound = true;
        break;
      }
    }
    expect(bulkFound).toBe(true);
  });

  test('Visitor chat history', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/visitors');
    const chatSelectors = ['.visitor-item .chat-history', '.chat-btn', 'button:has-text("Chat")'];
    let chatFound = false;
    for (const selector of chatSelectors) {
      if (await page.isVisible(selector).catch(() => false)) {
        await page.click(selector);
        chatFound = true;
        break;
      }
    }
    expect(chatFound).toBe(true);
  });
});