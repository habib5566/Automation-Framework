'use strict';

/**
 * Real browser console capture — local Playwright, or Vercel/serverless via @sparticuz/chromium.
 */
async function captureWithLocalPlaywright(url, opts) {
  const timeoutMs = opts.timeoutMs || 18_000;
  const waitAfterMs = opts.waitAfterMs != null ? opts.waitAfterMs : 3000;
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    return await collectConsoleLogs(browser, url, { timeoutMs, waitAfterMs });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function captureWithServerlessChromium(url, opts) {
  const timeoutMs = opts.timeoutMs || 28_000;
  const waitAfterMs = opts.waitAfterMs != null ? opts.waitAfterMs : 5500;
  const chromiumPack = require('@sparticuz/chromium');
  const { chromium } = require('playwright-core');

  chromiumPack.setGraphicsMode = false;

  const browser = await chromium.launch({
    args: chromiumPack.args,
    executablePath: await chromiumPack.executablePath(),
    headless: chromiumPack.headless,
  });
  try {
    return await collectConsoleLogs(browser, url, { timeoutMs, waitAfterMs });
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * @param {import('playwright').Browser | import('playwright-core').Browser} browser
 */
async function collectConsoleLogs(browser, url, opts) {
  const timeoutMs = opts.timeoutMs || 18_000;
  const waitAfterMs = opts.waitAfterMs != null ? opts.waitAfterMs : 3000;
  const page = await browser.newPage();
  /** @type {Array<{ type: string, text: string }>} */
  const logs = [];
  const seen = new Set();

  function push(type, text) {
    const t = String(text || '').trim();
    if (!t || t.length < 2) return;
    const key = type + '|' + t.slice(0, 240);
    if (seen.has(key)) return;
    seen.add(key);
    logs.push({ type, text: t.slice(0, 500) });
  }

  page.on('console', (msg) => {
    push(msg.type(), msg.text());
  });
  page.on('pageerror', (err) => {
    push('pageerror', String((err && err.message) || err));
  });
  page.on('requestfailed', (request) => {
    const fail = request.failure();
    const hint = fail && fail.errorText ? fail.errorText : 'net::ERR_FAILED';
    push('error', `Failed to load resource: ${hint} — ${request.url()}`);
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;
    const u = response.url();
    if (!u || /favicon\.ico$/i.test(u)) return;
    let short = u;
    try {
      short = new URL(u).pathname.split('/').pop() || u;
    } catch {
      /* keep */
    }
    push(
      'error',
      `Failed to load resource: the server responded with a status of ${status} (${short})`
    );
  });

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  });
  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(12_000, timeoutMs / 2) });
  } catch {
    /* SPA / long-polling — still wait below */
  }
  await page.waitForTimeout(waitAfterMs);

  return logs;
}

async function captureBrowserConsole(url, opts = {}) {
  const target = String(url || '').trim();
  if (!target) return { error: 'No URL', logs: [] };

  const isVercel =
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.VERCEL_ENV;

  const merged = {
    timeoutMs: opts.timeoutMs != null ? opts.timeoutMs : isVercel ? 28_000 : 18_000,
    waitAfterMs: opts.waitAfterMs != null ? opts.waitAfterMs : isVercel ? 5500 : 3000,
  };

  try {
    if (isVercel) {
      return await captureWithServerlessChromium(target, merged);
    }
    try {
      return await captureWithLocalPlaywright(target, merged);
    } catch (localErr) {
      const msg = String((localErr && localErr.message) || localErr);
      if (!/Cannot find module|playwright/i.test(msg)) throw localErr;
      return await captureWithServerlessChromium(target, merged);
    }
  } catch (e) {
    return { error: String((e && e.message) || e), logs: [] };
  }
}

module.exports = { captureBrowserConsole };
