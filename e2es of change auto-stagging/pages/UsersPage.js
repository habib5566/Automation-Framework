const BasePage = require('./BasePage');

class UsersPage extends BasePage {
  constructor(page) {
    super(page);
    this.addUserButton = 'button:has-text("Add User")';
    this.userNameInput = 'input[name="name"]';
    this.userEmailInput = 'input[name="email"]';
    this.userRoleSelect = 'select[name="role"]';
    this.saveButton = 'button:has-text("Save")';
  }

  async addUser(name, email, role) {
    await this.click(this.addUserButton);
    await this.type(this.userNameInput, name);
    await this.type(this.userEmailInput, email);
    await this.selectRole(role);
    await this.click(this.saveButton);
    await this.waitForLoad();
  }

  async selectRole(role) {
    const roleSelectors = [
      this.userRoleSelect,
      'select[name*="role"]',
      'div[role="combobox"] input',
      'input[aria-label*="Role"]',
      'input[placeholder*="Role"]',
    ];

    for (const selector of roleSelectors) {
      try {
        if (await this.page.isVisible(selector).catch(() => false)) {
          const element = await this.page.$(selector);
          if (!element) continue;
          const tagName = await element.evaluate(node => node.tagName.toLowerCase());
          if (tagName === 'select') {
            await this.page.selectOption(selector, role);
            return true;
          }
          await this.page.fill(selector, role);
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  async verifyUserAdded(email) {
    return await this.page.isVisible(`text=${email}`);
  }
}

module.exports = UsersPage;