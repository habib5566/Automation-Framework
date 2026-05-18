class BasePage {
  constructor(page) {
    this.page = page;
  }

  async navigate(path = '') {
    await this.page.goto(path);
    await this.page.waitForLoadState('networkidle');
  }

  async waitForLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  async click(selector) {
    await this.page.click(selector);
  }

  async type(selector, text) {
    await this.page.fill(selector, text);
  }

  async getText(selector) {
    return await this.page.textContent(selector);
  }

  async isVisible(selector) {
    try {
      return await this.page.isVisible(selector);
    } catch {
      return false;
    }
  }

  async waitForSelector(selector, options = {}) {
    if (Array.isArray(selector)) {
      await this.waitForAnySelector(selector, options);
      return;
    }
    await this.page.waitForSelector(selector, options);
  }

  async waitForAnySelector(selectors, options = {}) {
    const timeout = options.timeout ?? 5000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      for (const selector of selectors) {
        if (await this.isVisible(selector)) {
          return;
        }
      }
      await this.page.waitForTimeout(200);
    }
    throw new Error(`No selector visible: ${selectors.join(', ')}`);
  }
}

module.exports = BasePage;