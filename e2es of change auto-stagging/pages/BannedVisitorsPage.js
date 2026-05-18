const BasePage = require('./BasePage');

class BannedVisitorsPage extends BasePage {
  constructor(page) {
    super(page);
    this.banIpButton = 'button:has-text("BAN IP Address")';
    this.ipAddressInput = 'input[name="ip"]';
    this.reasonInput = 'textarea[name="reason"]';
    this.banButton = 'button:has-text("Ban")';
  }

  async banIPAddress(ip, reason) {
    await this.click(this.banIpButton);
    await this.type(this.ipAddressInput, ip);
    await this.type(this.reasonInput, reason);
    await this.click(this.banButton);
    await this.waitForLoad();
  }

  async verifyIPBanned(ip) {
    return await this.page.isVisible(`text=${ip}`);
  }
}

module.exports = BannedVisitorsPage;