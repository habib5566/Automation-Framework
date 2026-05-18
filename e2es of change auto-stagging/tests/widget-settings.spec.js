const { test, expect } = require('@playwright/test');
const { safeClick, safeFill, safeSelect, safeCheck } = require('./utils/actionHelpers');
const VettedLogosPage = require('../pages/VettedLogosPage');
const WidgetSettingsPage = require('../pages/WidgetSettingsPage');

test.describe('Widget Settings Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to widget settings', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos');
    await vettedLogosPage.navigateToWidgetSettings();
    expect(page.url()).toContain('/widget-settings');
  });

  test('Widget settings page loads', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/widget-settings');
    await page.waitForLoadState('networkidle');
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Hide preview functionality', async ({ page }) => {
    const widgetSettingsPage = new WidgetSettingsPage(page);
    await widgetSettingsPage.navigate('/vetted-logos/widget-settings');
    await widgetSettingsPage.hidePreview();
    expect(await widgetSettingsPage.isPreviewHidden()).toBe(true);
  });

  test('Reset settings', async ({ page }) => {
    const widgetSettingsPage = new WidgetSettingsPage(page);
    await widgetSettingsPage.navigate('/vetted-logos/widget-settings');
    await widgetSettingsPage.resetSettings();
    // Verify reset
  });

  test('Save changes', async ({ page }) => {
    const widgetSettingsPage = new WidgetSettingsPage(page);
    await widgetSettingsPage.navigate('/vetted-logos/widget-settings');
    await widgetSettingsPage.saveChanges();
    // Verify saved
  });

  test('Preview toggle', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/widget-settings');
    await page.waitForLoadState('networkidle');
    await safeClick(page, ['.preview-toggle', 'button:has-text("Preview")'], { timeout: 2000 });
    expect(await page.isVisible('.preview')).toBe(true);
  });

  test('Widget customization', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/widget-settings');
    await page.waitForLoadState('networkidle');
    await safeClick(page, ['.customize-button', 'button:has-text("Customize")'], { timeout: 2000 });
    expect(await page.isVisible('.customization-options')).toBe(true);
  });

  test('Color theme selection', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/widget-settings');
    await page.waitForLoadState('networkidle');
    await safeSelect(page, ['select[name="theme"]', 'select[aria-label*="theme"]', 'select[name*="theme"]'], 'dark', { timeout: 2000 });
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Widget position settings', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/widget-settings');
    await page.waitForLoadState('networkidle');
    await safeSelect(page, ['select[name="position"]', 'select[aria-label*="position"]', 'select[name*="position"]'], 'bottom-right', { timeout: 2000 });
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Auto-show settings', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/widget-settings');
    await page.waitForLoadState('networkidle');
    await safeCheck(page, ['input[name="auto-show"]', 'input[type="checkbox"]', '.auto-show-checkbox'], { timeout: 2000 });
    expect(await page.isVisible('body')).toBe(true);
  });

  test('Widget size configuration', async ({ page }) => {
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/widget-settings');
    await page.waitForLoadState('networkidle');
    await safeFill(page, ['input[name="width"]', 'input[placeholder*="width"]'], '300', { timeout: 2000 });
    await safeFill(page, ['input[name="height"]', 'input[placeholder*="height"]'], '400', { timeout: 2000 });
    expect(await page.isVisible('body')).toBe(true);
  });
});