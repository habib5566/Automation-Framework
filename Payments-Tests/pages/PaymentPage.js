/**
 * Payments admin module — https://designcentura.com/crm-pay/admin/payment
 */
class PaymentPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.path = '/crm-pay/admin/payment';
  }

  async open() {
    const res = await this.page.goto(this.path, { waitUntil: 'domcontentloaded' });
    await this.page.waitForLoadState('load').catch(() => {});
    return res;
  }

  async textLength() {
    return this.page.evaluate(() => (document.body?.innerText || '').trim().length);
  }
}

module.exports = { PaymentPage };
