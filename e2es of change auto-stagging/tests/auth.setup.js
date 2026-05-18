const { test: setup } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

setup('authenticate', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.navigate('/vetted-logos');
  await loginPage.login('hasananwar.sleekhive@gmail.com', 'ABCDabcd1234$$');
  await page.waitForURL('**/vetted-logos**');
  await page.context().storageState({ path: 'auth.json' });
});