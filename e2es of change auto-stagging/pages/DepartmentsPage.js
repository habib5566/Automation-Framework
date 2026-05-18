const BasePage = require('./BasePage');

class DepartmentsPage extends BasePage {
  constructor(page) {
    super(page);
    this.addDepartmentButton = 'button:has-text("Add Department")';
    this.departmentNameInput = 'input[name="name"]';
    this.departmentDescriptionInput = 'textarea[name="description"]';
    this.saveButton = 'button:has-text("Save")';
  }

  async addDepartment(name, description) {
    await this.click(this.addDepartmentButton);
    await this.type(this.departmentNameInput, name);
    await this.type(this.departmentDescriptionInput, description);
    await this.click(this.saveButton);
    await this.waitForLoad();
  }

  async verifyDepartmentAdded(name) {
    return await this.page.isVisible(`text=${name}`);
  }
}

module.exports = DepartmentsPage;