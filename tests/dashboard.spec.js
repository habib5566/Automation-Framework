const { test, expect } = require('./fixtures/customTest');
const { LoginPage } = require('../pages/LoginPage');
const { DashboardPage } = require('../pages/DashboardPage');
const { login, navigation } = require('../utils/test-data');

test.describe('Dashboard navigation', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'staging-autobotx', 'Demo app only');
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await loginPage.login(login.valid.username, login.valid.password);
    await expect(page).toHaveURL(/dashboard\.html$/);
  });

  test('user can move between overview, reports, and settings', async ({ page }) => {
    const dashboard = new DashboardPage(page);

    await dashboard.expectOnOverview();
    await expect(dashboard.title).toHaveText('Dashboard');

    await dashboard.openReports();
    await expect(page).toHaveURL(/reports\.html$/);
    await expect(dashboard.reportsHeading).toHaveText(navigation.reportsHeading);

    await dashboard.openSettings();
    await expect(page).toHaveURL(/settings\.html$/);
    await expect(dashboard.settingsHeading).toHaveText(navigation.settingsHeading);

    await dashboard.openOverview();
    await expect(page).toHaveURL(/dashboard\.html$/);
    await dashboard.expectOnOverview();
  });
});
