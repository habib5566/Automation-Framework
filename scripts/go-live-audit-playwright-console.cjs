'use strict';

/**
 * Optional real browser console capture (requires @playwright/test / playwright).
 */
async function captureBrowserConsole(url, opts = {}) {
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 18_000;
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    /** @type {Array<{ type: string, text: string }>} */
    const logs = [];
    page.on('console', (msg) => {
      logs.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
      logs.push({ type: 'pageerror', text: String((err && err.message) || err) });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(Math.min(3000, timeoutMs / 4));
    await browser.close();
    return logs;
  } catch (e) {
    return { error: String((e && e.message) || e), logs: [] };
  }
}

module.exports = { captureBrowserConsole };
