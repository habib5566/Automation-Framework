const BasePage = require('./BasePage');

class WidgetSettingsPage extends BasePage {
  constructor(page) {
    super(page);
    this.hidePreviewButton = 'button:has-text("Hide Preview")';
    this.resetButton = 'button:has-text("Reset")';
    this.saveChangesButton = 'button:has-text("Save Changes")';
    this.previewElement = '.preview';
  }

  async hidePreview() {
    await this.click(this.hidePreviewButton);
  }

  async resetSettings() {
    await this.click(this.resetButton);
  }

  async saveChanges() {
    await this.click(this.saveChangesButton);
    await this.waitForLoad();
  }

  async isPreviewHidden() {
    return !(await this.page.isVisible(this.previewElement));
  }
}

module.exports = WidgetSettingsPage;