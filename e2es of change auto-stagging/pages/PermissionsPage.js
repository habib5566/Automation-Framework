const BasePage = require('./BasePage');

class PermissionsPage extends BasePage {
  constructor(page) {
    super(page);
    this.addPermissionButton = 'button:has-text("Add Permission")';
    this.permissionNameInput = 'input[name="name"]';
    this.permissionDescriptionInput = 'textarea[name="description"]';
    this.saveButton = 'button:has-text("Save")';
  }

  async addPermission(name, description) {
    await this.click(this.addPermissionButton);
    await this.type(this.permissionNameInput, name);
    await this.type(this.permissionDescriptionInput, description);
    await this.click(this.saveButton);
    await this.waitForLoad();
  }

  async verifyPermissionAdded(name) {
    return await this.page.isVisible(`text=${name}`);
  }
}

module.exports = PermissionsPage;