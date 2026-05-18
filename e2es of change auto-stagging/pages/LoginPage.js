const BasePage = require('./BasePage');

class LoginPage extends BasePage {
  constructor(page) {
    super(page);
    this.emailInput = 'input[type="email"]';
    this.passwordInput = 'input[type="password"]';
    this.loginButton = 'button[type="submit"]';
  }

  async login(email, password) {
    await this.type(this.emailInput, email);
    await this.type(this.passwordInput, password);
    await this.click(this.loginButton);
    await this.waitForLoad();
  }

  async isLoggedIn() {
    // Check if redirected to dashboard or some element is visible
    return await this.page.url().includes('/vetted-logos');
  }
}

module.exports = LoginPage;