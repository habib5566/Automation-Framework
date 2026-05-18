const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { LoginPage } = require('../pages/LoginPage');

const authFile = path.join(__dirname, '..', 'playwright', '.auth', 'admin.json');

test.describe('setup', () => {
  test('authenticate and save session', async ({ page }) => {
    test.setTimeout(120_000);
    const email = process.env.DESIGNCENTURA_EMAIL;
    const password = process.env.DESIGNCENTURA_PASSWORD;

    if (!email || !password) {
      throw new Error(
        'Missing DESIGNCENTURA_EMAIL or DESIGNCENTURA_PASSWORD. Copy .env.example to .env and set values.'
      );
    }

    fs.mkdirSync(path.dirname(authFile), { recursive: true });

    const login = new LoginPage(page);
    await login.gotoLogin();
    await login.loginAs(email, password);

    await expect(page).toHaveURL(/\/crm-pay\/admin\/(?!login)/, { timeout: 45_000 });

    await page.context().storageState({ path: authFile });
  });
});
