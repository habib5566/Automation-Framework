const BasePage = require('./BasePage');

class CannedResponsesPage extends BasePage {
  constructor(page) {
    super(page);
    this.addResponseButton = 'button:has-text("Add Response")';
    this.responseTitleInput = 'input[name="title"]';
    this.responseContentInput = 'textarea[name="content"]';
    this.saveButton = 'button:has-text("Save")';
  }

  async addResponse(title, content) {
    await this.click(this.addResponseButton);
    await this.type(this.responseTitleInput, title);
    await this.type(this.responseContentInput, content);
    await this.click(this.saveButton);
    await this.waitForLoad();
  }

  async verifyResponseAdded(title) {
    return await this.page.isVisible(`text=${title}`);
  }
}

module.exports = CannedResponsesPage;