const { test, expect } = require('./fixtures/customTest');
const { LoginPage } = require('../pages/LoginPage');
const { login } = require('../utils/test-data');

test.describe('Login', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'staging-autobotx', 'Demo app only — use staging specs for AutobotX');
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await loginPage.login(login.valid.username, login.valid.password);
    await expect(page).toHaveURL(/dashboard\.html$/);
    await expect(page.locator('#welcome-text')).toBeVisible();
  });

  test('invalid password shows error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await loginPage.login(login.invalidPassword.username, login.invalidPassword.password);
    await loginPage.expectErrorContains('Invalid username or password');
    await expect(page).not.toHaveURL(/dashboard\.html$/);
  });

  test('unknown user shows error', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await loginPage.login(login.invalidUser.username, login.invalidUser.password);
    await loginPage.expectErrorContains('Invalid username or password');
  });
});
