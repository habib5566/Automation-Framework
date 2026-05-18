const { test, expect } = require('@playwright/test');
const VettedLogosPage = require('../pages/VettedLogosPage');
const CannedResponsesPage = require('../pages/CannedResponsesPage');

test.describe('Canned Responses Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to canned responses page', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos');
    await vettedLogosPage.navigateToCannedResponses();
    expect(page.url()).toContain('/canned-responses');
  });

  test('Canned responses page loads', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/canned-responses');
    expect(await page.isVisible('.responses-list')).toBe(true);
  });

  test('Add response functionality', async ({ page }) => {
    const cannedResponsesPage = new CannedResponsesPage(page);
    await cannedResponsesPage.navigate('/vetted-logos/canned-responses');
    await cannedResponsesPage.addResponse('Welcome Message', 'Hello! How can I help you today?');
    expect(await cannedResponsesPage.verifyResponseAdded('Welcome Message')).toBe(true);
  });

  test('Edit canned response', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/canned-responses');
    await page.click('.response-item .edit');
    await page.fill('textarea[name="content"]', 'Updated response');
    await page.click('button:has-text("Save")');
    expect(await page.isVisible('text=Updated response')).toBe(true);
  });

  test('Delete canned response', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/canned-responses');
    await page.click('.response-item .delete');
    await page.click('button:has-text("Confirm")');
    // Verify deleted
  });

  test('Search responses', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/canned-responses');
    await page.fill('input[placeholder*="search"]', 'welcome');
    await page.click('button:has-text("Search")');
    // Verify search
  });

  test('Response categories', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/canned-responses');
    await page.selectOption('select[name="category"]', 'greeting');
    // Verify filtered
  });

  test('Insert response in chat', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/canned-responses');
    await page.click('.response-item .insert');
    // Verify inserted in chat
  });

  test('Response shortcuts', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/canned-responses');
    expect(await page.isVisible('.shortcut')).toBe(true);
  });

  test('Response usage statistics', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/canned-responses');
    expect(await page.isVisible('.usage-stats')).toBe(true);
  });

  test('Bulk response operations', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/canned-responses');
    await page.check('.response-checkbox');
    await page.click('button:has-text("Bulk Actions")');
    // Verify bulk
  });
});