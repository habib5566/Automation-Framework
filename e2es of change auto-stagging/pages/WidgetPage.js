const BasePage = require('./BasePage');

class WidgetPage extends BasePage {
  constructor(page) {
    super(page);
    this.messageInput = 'input[placeholder*="message"]';
    this.sendButton = 'button:has-text("Send")';
    this.fileInput = 'input[type="file"]';
    this.attachButton = 'button:has-text("Attach")';
  }

  async sendMessage(message) {
    await this.type(this.messageInput, message);
    await this.click(this.sendButton);
    await this.waitForLoad();
  }

  async attachFile(filePath) {
    await this.page.setInputFiles(this.fileInput, filePath);
    await this.click(this.attachButton);
    await this.waitForLoad();
  }

  async verifyMessageSent(message) {
    return await this.page.isVisible(`text=${message}`);
  }

  async checkNotification() {
    // Assuming there's a notification element
    return await this.page.isVisible('.notification');
  }
}

module.exports = WidgetPage;