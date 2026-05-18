const BasePage = require('./BasePage');

class TagsPage extends BasePage {
  constructor(page) {
    super(page);
    this.createTagButton = 'button:has-text("Create Tag")';
    this.tagNameInput = 'input[name="name"]';
    this.tagColorInput = 'input[name="color"]';
    this.saveButton = 'button:has-text("Save")';
  }

  async createTag(name, color) {
    await this.click(this.createTagButton);
    await this.type(this.tagNameInput, name);
    await this.type(this.tagColorInput, color);
    await this.click(this.saveButton);
    await this.waitForLoad();
  }

  async verifyTagCreated(name) {
    return await this.page.isVisible(`text=${name}`);
  }
}

module.exports = TagsPage;