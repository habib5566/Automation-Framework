const { test, expect } = require('./fixtures/customTest');
const { AutobotxVisitorsPage } = require('../pages/AutobotxVisitorsPage');

test.describe('AutobotX staging — vetted logos visitors', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== 'staging-autobotx',
      'Run: npm run test:staging — or npx playwright test --project=staging-autobotx'
    );
  });

  test('visitors page loads (URL + Chat Dashboard title)', async ({ page }) => {
    const visitors = new AutobotxVisitorsPage(page);
    await visitors.openVisitors();

    await expect(page).toHaveURL(/vetted-logos\/visitors/);
    await expect(page).toHaveTitle(/Chat Dashboard/i);
    await expect(page.locator('body')).toBeVisible();
  });
});
