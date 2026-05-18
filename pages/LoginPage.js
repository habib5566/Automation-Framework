const { BasePage } = require('./BasePage');

class LoginPage extends BasePage {
  constructor(page) {
    super(page);
    this.username = page.locator('#username');
    this.password = page.locator('#password');
    this.submit = page.locator('#login-button');
    this.error = page.locator('#error-message');
  }

  async open() {
    await this.goto('/');
  }

  async login(username, password) {
    await this.run('fill credentials', async () => {
      await this.username.fill(username);
      await this.password.fill(password);
    });
    await this.run('submit login', () => this.submit.click());
  }

  async expectErrorContains(text) {
    await this.run('assert error visible', async () => {
      await this.error.waitFor({ state: 'visible' });
      await this.page.getByRole('alert').filter({ hasText: text }).waitFor({ state: 'visible' });
    });
  }
}

module.exports = { LoginPage };
