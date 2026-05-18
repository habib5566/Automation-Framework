const { BasePage } = require('./BasePage');

/** Staging dashboard — visitors route ([staging base]/vetted-logos/visitors). */
class AutobotxVisitorsPage extends BasePage {
  constructor(page) {
    super(page);
    this.visitorsPath = '/vetted-logos/visitors';
  }

  async openVisitors() {
    await this.run('open visitors', () => this.page.goto(this.visitorsPath));
    await this.page.waitForLoadState('domcontentloaded');
  }
}

module.exports = { AutobotxVisitorsPage };
