const BasePage = require('./BasePage');

class PersonalPage extends BasePage {
  constructor(page) {
    super(page);
    this.editButton = 'button:has-text("Edit")';
    this.nameInput = 'input[name="name"]';
    this.emailInput = 'input[name="email"]';
    this.saveButton = 'button:has-text("Save")';
  }

  async editProfile(name, email) {
    await this.click(this.editButton);
    await this.type(this.nameInput, name);
    await this.type(this.emailInput, email);
    await this.click(this.saveButton);
    await this.waitForLoad();
  }

  async verifyProfileUpdated(name) {
    return await this.page.isVisible(`text=${name}`);
  }
}

module.exports = PersonalPage;