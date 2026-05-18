const BasePage = require('./BasePage');

class TriggersPage extends BasePage {
  constructor(page) {
    super(page);
    this.addTriggerButton = 'button:has-text("Add Trigger")';
    this.triggerNameInput = 'input[name="name"]';
    this.triggerConditionInput = 'input[name="condition"]';
    this.triggerActionInput = 'input[name="action"]';
    this.saveButton = 'button:has-text("Save")';
  }

  async addTrigger(name, condition, action) {
    await this.click(this.addTriggerButton);
    await this.type(this.triggerNameInput, name);
    await this.type(this.triggerConditionInput, condition);
    await this.type(this.triggerActionInput, action);
    await this.click(this.saveButton);
    await this.waitForLoad();
  }

  async verifyTriggerAdded(name) {
    return await this.page.isVisible(`text=${name}`);
  }
}

module.exports = TriggersPage;