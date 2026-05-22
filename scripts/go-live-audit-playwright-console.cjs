'use strict';

/**
 * Real browser console capture — local Playwright, or Vercel/serverless via @sparticuz/chromium.
 */
function resolveLocalChromium() {
  try {
    return require('playwright').chromium;
  } catch {
    /* full playwright package optional */
  }
  try {
    return require('@playwright/test').chromium;
  } catch {
    /* devDependency — present when you run npm install locally */
  }
  return require('playwright-core').chromium;
}

async function captureWithLocalPlaywright(url, opts) {
  const timeoutMs = opts.timeoutMs || 18_000;
  const waitAfterMs = opts.waitAfterMs != null ? opts.waitAfterMs : 3000;
  const chromium = resolveLocalChromium();
  const browser = await chromium.launch({ headless: true });
  try {
    return await collectConsoleLogs(browser, url, { timeoutMs, waitAfterMs });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function captureWithServerlessChromium(url, opts) {
  const timeoutMs = opts.timeoutMs || 35_000;
  const waitAfterMs = opts.waitAfterMs != null ? opts.waitAfterMs : 8000;
  const chromiumPack = require('@sparticuz/chromium');
  const { chromium } = require('playwright-core');

  chromiumPack.setGraphicsMode = false;

  const executablePath = await chromiumPack.executablePath();
  const browser = await chromium.launch({
    args: chromiumPack.args,
    executablePath,
    headless: true,
    ignoreHTTPSErrors: true,
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
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
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
    if (!u || /favicon\.ico|\.woff2?|\.png|\.jpg|\.gif|analytics|google-analytics/i.test(u)) return;
    const rt = response.request().resourceType();
    if (!['document', 'script', 'stylesheet', 'xhr', 'fetch'].includes(rt)) return;
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

  await context.close().catch(() => {});
  return logs;
}

/** True only on Vercel/AWS Lambda — not `vercel dev` or random VERCEL_ENV in .env */
function isServerlessChromiumRuntime() {
  if (process.env.GO_LIVE_AUDIT_FORCE_LOCAL_PLAYWRIGHT === '1') return false;
  if (process.env.GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM === '1') return true;
  return !!process.env.AWS_LAMBDA_FUNCTION_NAME;
}

async function captureBrowserConsole(url, opts = {}) {
  const target = String(url || '').trim();
  if (!target) return { error: 'No URL', logs: [] };

  const serverless = isServerlessChromiumRuntime();
  const merged = {
    timeoutMs: opts.timeoutMs != null ? opts.timeoutMs : serverless ? 35_000 : 18_000,
    waitAfterMs: opts.waitAfterMs != null ? opts.waitAfterMs : serverless ? 8000 : 3000,
  };

  try {
    if (serverless) {
      const logs = await captureWithServerlessChromium(target, merged);
      return { logs: Array.isArray(logs) ? logs : [], runtime: 'serverless' };
    }
    const logs = await captureWithLocalPlaywright(target, merged);
    return { logs: Array.isArray(logs) ? logs : [], runtime: 'local' };
  } catch (e) {
    const msg = String((e && e.message) || e);
    // eslint-disable-next-line no-console
    console.warn('[go-live-audit] console capture failed:', msg);
    return { error: msg, logs: [], runtime: serverless ? 'serverless' : 'local' };
  }
}

module.exports = { captureBrowserConsole, isServerlessChromiumRuntime };
