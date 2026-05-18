const { expect } = require('@playwright/test');

class LoginPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
  }

  async gotoLogin() {
    await this.page.goto('/crm-pay/admin/login', { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('load').catch(() => {});
  }

  /**
   * Resilient selectors: labels vary ("Email", "Email address") and password is often
   * `input[type="password"]` (not always role=textbox + exact name "Password").
   */
  async loginAs(email, password) {
    const emailField = this.page
      .getByRole('textbox', { name: /email/i })
      .or(this.page.locator('input[type="email"]'))
      .or(this.page.locator('input[name*="email" i]'))
      .first();

    const passField = this.page
      .getByRole('textbox', { name: /password/i })
      .or(this.page.getByLabel(/password/i))
      .or(this.page.locator('input[type="password"]'))
      .first();

    await emailField.waitFor({ state: 'visible', timeout: 45_000 });
    await emailField.click();
    await emailField.fill('');
    await emailField.fill(email);

    await passField.click();
    await passField.fill('');
    await passField.fill(password);

    const submit = this.page.getByRole('button', {
      name: /sign\s*in|log\s*in|login|submit|continue/i,
    });
    await expect(submit).toBeVisible({ timeout: 15_000 });
    await expect(submit).toBeEnabled({ timeout: 45_000 });
    await submit.click();

    await this.page.waitForLoadState('networkidle').catch(() => {});
  }
}

module.exports = { LoginPage };
