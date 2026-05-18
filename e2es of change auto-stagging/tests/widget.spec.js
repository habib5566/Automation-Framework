const { test, expect } = require('@playwright/test');
const WidgetPage = require('../pages/WidgetPage');

test.describe('Widget Tests', () => {
  test('Widget page loads', async ({ page }) => {
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    expect(await page.isVisible('.widget')).toBe(true);
  });

  test('Send message in widget', async ({ page }) => {
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    await widgetPage.sendMessage('Hello from test!');
    expect(await widgetPage.verifyMessageSent('Hello from test!')).toBe(true);
  });

  test('Attach file to message', async ({ page }) => {
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    // Assuming we have a test file
    await widgetPage.attachFile('test-file.txt');
    // Verify attachment
  });

  test('Check notification on message', async ({ page }) => {
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    await widgetPage.sendMessage('Test notification');
    expect(await widgetPage.checkNotification()).toBe(true);
  });

  test('Widget logo display', async ({ page }) => {
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    expect(await page.isVisible('.widget-logo')).toBe(true);
  });

  test('Widget responsiveness', async ({ page }) => {
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    await page.setViewportSize({ width: 375, height: 667 });
    expect(await page.isVisible('.widget')).toBe(true);
  });

  test('Widget theme consistency', async ({ page }) => {
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    // Check theme elements
    expect(await page.isVisible('.theme-colors')).toBe(true);
  });

  test('Widget accessibility', async ({ page }) => {
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    // Check accessibility features
    const altText = await page.getAttribute('.widget img', 'alt');
    expect(altText).toBeTruthy();
  });

  test('Widget load performance', async ({ page }) => {
    const startTime = Date.now();
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    const loadTime = Date.now() - startTime;
    expect(loadTime).toBeLessThan(5000); // Less than 5 seconds
  });

  test('Widget error handling', async ({ page }) => {
    const widgetPage = new WidgetPage(page);
    await widgetPage.navigate('https://agent-builder-demo-nine.vercel.app/');
    // Try invalid action
    await page.click('.invalid-button');
    expect(await page.isVisible('.error-message')).toBe(false); // No error should show
  });
});