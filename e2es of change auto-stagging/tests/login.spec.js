const { test, expect } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');
const path = require('path');

test.describe('Login Tests', () => {
  test('Successful login with valid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate('/vetted-logos');
    await loginPage.login('hasananwar.sleekhive@gmail.com', 'ABCDabcd1234$$');
    expect(await loginPage.isLoggedIn()).toBe(true);
    // Save auth state
    await page.context().storageState({ path: path.join(__dirname, '..', 'auth.json') });
  });

  test('Login page loads correctly', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate('/vetted-logos');
    expect(await page.isVisible('input[type="email"]')).toBe(true);
    expect(await page.isVisible('input[type="password"]')).toBe(true);
  });

  test('Invalid email shows error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate('/vetted-logos');
    await loginPage.login('invalid@email.com', 'ABCDabcd1234$$');
    expect(await page.isVisible('.error')).toBe(true);
  });

  test('Invalid password shows error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate('/vetted-logos');
    await loginPage.login('hasananwar.sleekhive@gmail.com', 'wrongpassword');
    expect(await page.isVisible('.error')).toBe(true);
  });

  test('Empty fields show validation', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate('/vetted-logos');
    await loginPage.click('button[type="submit"]');
    expect(await page.isVisible('.error')).toBe(true);
  });
});