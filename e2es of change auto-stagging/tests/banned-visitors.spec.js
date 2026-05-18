const { test, expect } = require('@playwright/test');
const VettedLogosPage = require('../pages/VettedLogosPage');
const BannedVisitorsPage = require('../pages/BannedVisitorsPage');

test.describe('Banned Visitors Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to banned visitors page', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos');
    await vettedLogosPage.navigateToBannedVisitors();
    expect(page.url()).toContain('/banned-visitors');
  });

  test('Banned visitors page loads', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/banned-visitors');
    expect(await page.isVisible('.banned-visitors-list')).toBe(true);
  });

  test('Ban IP address functionality', async ({ page }) => {
    const bannedVisitorsPage = new BannedVisitorsPage(page);
    await bannedVisitorsPage.navigate('/vetted-logos/banned-visitors');
    await bannedVisitorsPage.banIPAddress('192.168.1.1', 'Test ban reason');
    expect(await bannedVisitorsPage.verifyIPBanned('192.168.1.1')).toBe(true);
  });

  test('Unban visitor', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/banned-visitors');
    await page.click('.banned-item .unban');
    await page.click('button:has-text("Confirm")');
    // Verify unbanned
  });

  test('Ban reason display', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/banned-visitors');
    expect(await page.isVisible('.ban-reason')).toBe(true);
  });

  test('Ban duration', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/banned-visitors');
    await page.selectOption('select[name="duration"]', 'permanent');
    // Verify duration
  });

  test('Search banned visitors', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/banned-visitors');
    await page.fill('input[placeholder*="search"]', '192.168');
    await page.click('button:has-text("Search")');
    // Verify search
  });

  test('Ban history', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/banned-visitors');
    await page.click('.banned-item .history');
    expect(await page.isVisible('.ban-history')).toBe(true);
  });

  test('Bulk unban', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/banned-visitors');
    await page.check('.ban-checkbox');
    await page.click('button:has-text("Unban Selected")');
    // Verify bulk unban
  });

  test('Ban statistics', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/banned-visitors');
    expect(await page.isVisible('.ban-stats')).toBe(true);
  });

  test('IP range banning', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/banned-visitors');
    await page.check('input[name="range-ban"]');
    await page.fill('input[name="ip-range"]', '192.168.1.0/24');
    // Verify range ban
  });
});