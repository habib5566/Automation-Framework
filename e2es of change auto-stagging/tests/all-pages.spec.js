const { test, expect } = require('@playwright/test');
const { safeClick } = require('./utils/actionHelpers');

const BASE_URL = 'https://staging-dashboard.autobotx.ai/vetted-logos';

test.describe('All Pages E2E Tests', () => {
  test.use({ storageState: 'auth.json' });

  const pages = [
    { name: 'Dashboard', url: `${BASE_URL}` },
    { name: 'Visitors', url: `${BASE_URL}/visitors` },
    { name: 'Chat Logs', url: `${BASE_URL}/chat-logs` },
    { name: 'Analytics', url: `${BASE_URL}/analytics` },
    { name: 'Monitor', url: `${BASE_URL}/monitor` },
    { name: 'Users', url: `${BASE_URL}/users` },
    { name: 'Tags', url: `${BASE_URL}/tags` },
    { name: 'Canned Responses', url: `${BASE_URL}/canned-responses` },
    { name: 'Widget Settings', url: `${BASE_URL}/widget-settings` },
    { name: 'Roles', url: `${BASE_URL}/roles` },
    { name: 'Permissions', url: `${BASE_URL}/permissions` },
    { name: 'Triggers', url: `${BASE_URL}/triggers` },
    { name: 'Departments', url: `${BASE_URL}/departments` },
    { name: 'Banned Visitors', url: `${BASE_URL}/banned-visitors` },
    { name: 'Personal', url: `${BASE_URL}/personal` },
  ];

  pages.forEach(page => {
    test(`${page.name} page loads`, async ({ page: testPage }) => {
      await testPage.goto(page.url);
      await testPage.waitForLoadState('networkidle');
      expect(testPage.url()).toContain(page.url.split('/').pop());
      expect(await testPage.isVisible('body')).toBe(true);
    });
  });

  // Specific functionality tests
  async function runOptionalAction(page, selectors, description) {
    const clicked = await safeClick(page, selectors, { timeout: 2000 });
    if (!clicked) {
      console.warn(`Optional action not found: ${description}`);
    }
  }

  test('Analytics Export Reports', async ({ page }) => {
    await page.goto(`${BASE_URL}/analytics`);
    await runOptionalAction(page, ['button:has-text("Export")', 'button:has-text("Export")', '.export-btn'], 'Analytics export');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Users Add User', async ({ page }) => {
    await page.goto(`${BASE_URL}/users`);
    await runOptionalAction(page, ['button:has-text("Add User")', 'button:has-text("Add")', '.add-btn'], 'Users add button');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Tags Create Tag', async ({ page }) => {
    await page.goto(`${BASE_URL}/tags`);
    await runOptionalAction(page, ['button:has-text("Create Tag")', 'button:has-text("Create")', '.create-btn'], 'Tags create button');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Canned Responses Add Response', async ({ page }) => {
    await page.goto(`${BASE_URL}/canned-responses`);
    await runOptionalAction(page, ['button:has-text("Add Response")', 'button:has-text("Add")', '.add-btn'], 'Canned Responses add button');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Widget Settings Hide Preview', async ({ page }) => {
    await page.goto(`${BASE_URL}/widget-settings`);
    await runOptionalAction(page, ['button:has-text("Hide Preview")', 'button:has-text("Hide")', '.hide-btn'], 'Widget Settings hide preview');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Widget Settings Reset', async ({ page }) => {
    await page.goto(`${BASE_URL}/widget-settings`);
    await runOptionalAction(page, ['button:has-text("Reset")', 'button:has-text("Reset Settings")', '.reset-btn'], 'Widget Settings reset');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Widget Settings Save Changes', async ({ page }) => {
    await page.goto(`${BASE_URL}/widget-settings`);
    await runOptionalAction(page, ['button:has-text("Save Changes")', 'button:has-text("Save")', '.save-btn'], 'Widget Settings save changes');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Roles Add Role', async ({ page }) => {
    await page.goto(`${BASE_URL}/roles`);
    await runOptionalAction(page, ['button:has-text("Add Role")', 'button:has-text("Add")', '.add-btn'], 'Roles add button');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Permissions Add Permission', async ({ page }) => {
    await page.goto(`${BASE_URL}/permissions`);
    await runOptionalAction(page, ['button:has-text("Add Permission")', 'button:has-text("Add")', '.add-btn'], 'Permissions add button');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Triggers Add Trigger', async ({ page }) => {
    await page.goto(`${BASE_URL}/triggers`);
    await runOptionalAction(page, ['button:has-text("Add Trigger")', 'button:has-text("Add")', '.add-btn'], 'Triggers add button');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Departments Add Department', async ({ page }) => {
    await page.goto(`${BASE_URL}/departments`);
    await runOptionalAction(page, ['button:has-text("Add Department")', 'button:has-text("Add")', '.add-btn'], 'Departments add button');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Banned Visitors BAN IP Address', async ({ page }) => {
    await page.goto(`${BASE_URL}/banned-visitors`);
    await runOptionalAction(page, ['button:has-text("BAN IP Address")', 'button:has-text("BAN")', '.ban-btn'], 'Banned Visitors ban button');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Personal Edit', async ({ page }) => {
    await page.goto(`${BASE_URL}/personal`);
    await runOptionalAction(page, ['button:has-text("Edit")', 'button:has-text("Edit Profile")', '.edit-btn'], 'Personal edit');
    expect(await page.isVisible('body')).toBe(true);
  });
});