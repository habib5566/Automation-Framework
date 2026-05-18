const BasePage = require('./BasePage');

class RolesPage extends BasePage {
  constructor(page) {
    super(page);
    this.addRoleButton = 'button:has-text("Add Role")';
    this.roleNameInput = 'input[name="name"]';
    this.roleDescriptionInput = 'textarea[name="description"]';
    this.saveButton = 'button:has-text("Save")';
  }

  async addRole(name, description) {
    await this.click(this.addRoleButton);
    await this.type(this.roleNameInput, name);
    await this.type(this.roleDescriptionInput, description);
    await this.click(this.saveButton);
    await this.waitForLoad();
  }

  async verifyRoleAdded(name) {
    return await this.page.isVisible(`text=${name}`);
  }
}

module.exports = RolesPage;