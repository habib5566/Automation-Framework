const { test, expect } = require('@playwright/test');
const VettedLogosPage = require('../pages/VettedLogosPage');
const TriggersPage = require('../pages/TriggersPage');

test.describe('Triggers Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to triggers page', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos');
    await vettedLogosPage.navigateToTriggers();
    expect(page.url()).toContain('/triggers');
  });

  test('Triggers page loads', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    expect(await page.isVisible('.triggers-list')).toBe(true);
  });

  test('Add trigger functionality', async ({ page }) => {
    const triggersPage = new TriggersPage(page);
    await triggersPage.navigate('/vetted-logos/triggers');
    await triggersPage.addTrigger('Test Trigger', 'visitor_online', 'send_welcome');
    expect(await triggersPage.verifyTriggerAdded('Test Trigger')).toBe(true);
  });

  test('Edit trigger', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    await page.click('.trigger-item .edit');
    await page.fill('input[name="name"]', 'Updated Trigger');
    await page.click('button:has-text("Save")');
    expect(await page.isVisible('text=Updated Trigger')).toBe(true);
  });

  test('Delete trigger', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    await page.click('.trigger-item .delete');
    await page.click('button:has-text("Confirm")');
    // Verify deleted
  });

  test('Trigger conditions', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    await page.click('.trigger-item .conditions');
    expect(await page.isVisible('.condition-builder')).toBe(true);
  });

  test('Trigger actions', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    await page.click('.trigger-item .actions');
    expect(await page.isVisible('.action-list')).toBe(true);
  });

  test('Search triggers', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    await page.fill('input[placeholder*="search"]', 'welcome');
    await page.click('button:has-text("Search")');
    // Verify search
  });

  test('Trigger priority', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    await page.selectOption('select[name="priority"]', 'high');
    // Verify filtered
  });

  test('Trigger testing', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    await page.click('.trigger-item .test');
    expect(await page.isVisible('.test-results')).toBe(true);
  });

  test('Trigger activation toggle', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    await page.click('.trigger-item .toggle');
    // Verify status change
  });

  test('Trigger logs', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/triggers');
    await page.click('.trigger-item .logs');
    expect(await page.isVisible('.trigger-logs')).toBe(true);
  });
});