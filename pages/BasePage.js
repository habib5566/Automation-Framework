const logger = require('../utils/logger');

class BasePage {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page;
  }

  /**
   * Wraps an action with consistent error context for reports and logs.
   * @template T
   * @param {string} actionName
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async run(actionName, fn) {
    try {
      return await fn();
    } catch (error) {
      logger.error(`Page action failed: ${actionName}`, error);
      throw error;
    }
  }

  async goto(path) {
    await this.run(`goto ${path}`, () => this.page.goto(path));
  }
}

module.exports = { BasePage };
