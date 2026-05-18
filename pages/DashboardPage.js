const { BasePage } = require('./BasePage');

class DashboardPage extends BasePage {
  constructor(page) {
    super(page);
    this.title = page.locator('#dashboard-title');
    this.welcome = page.locator('#welcome-text');
    this.navOverview = page.locator('#nav-overview');
    this.navReports = page.locator('#nav-reports');
    this.navSettings = page.locator('#nav-settings');
    this.reportsHeading = page.locator('#reports-heading');
    this.settingsHeading = page.locator('#settings-heading');
  }

  async openOverview() {
    await this.run('open overview', () => this.navOverview.click());
  }

  async openReports() {
    await this.run('open reports', () => this.navReports.click());
  }

  async openSettings() {
    await this.run('open settings', () => this.navSettings.click());
  }

  async expectOnOverview() {
    await this.run('assert overview', async () => {
      await this.title.waitFor({ state: 'visible' });
      await this.welcome.waitFor({ state: 'visible' });
    });
  }
}

module.exports = { DashboardPage };
