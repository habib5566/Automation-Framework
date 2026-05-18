const { test, expect } = require('@playwright/test');
const VettedLogosPage = require('../pages/VettedLogosPage');

test.describe('Monitor Page Tests', () => {
  test.use({ storageState: 'auth.json' });

  test('Navigate to monitor page', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos');
    await vettedLogosPage.navigateToMonitor();
    expect(page.url()).toContain('/monitor');
  });

  test('Monitor dashboard loads', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/monitor');
    expect(await page.isVisible('.monitor-dashboard')).toBe(true);
  });

  test('Real-time visitor monitoring', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/monitor');
    expect(await page.isVisible('.live-visitors')).toBe(true);
  });

  test('Active chat sessions', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/monitor');
    expect(await page.isVisible('.active-chats')).toBe(true);
  });

  test('System performance metrics', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/monitor');
    expect(await page.isVisible('.performance-metrics')).toBe(true);
  });

  test('Alert notifications', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/monitor');
    expect(await page.isVisible('.alerts')).toBe(true);
  });

  test('Monitor agent status', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/monitor');
    expect(await page.isVisible('.agent-status')).toBe(true);
  });

  test('Queue management', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/monitor');
    expect(await page.isVisible('.queue-list')).toBe(true);
  });

  test('Response time tracking', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/monitor');
    expect(await page.isVisible('.response-times')).toBe(true);
  });

  test('Monitor settings', async ({ page }) => {
    const vettedLogosPage = new VettedLogosPage(page);
    await vettedLogosPage.navigate('/vetted-logos/monitor');
    await page.click('button:has-text("Settings")');
    expect(await page.isVisible('.monitor-settings')).toBe(true);
  });
});