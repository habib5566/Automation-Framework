'use strict';

const { ensureServerlessChromiumEnv } = require('./go-live-audit-chromium-env.cjs');

/**
 * Browser console capture — local Playwright; Vercel/Lambda via puppeteer-core + @sparticuz/chromium.
 */
function resolveLocalChromium() {
  try {
    return require('playwright').chromium;
  } catch {
    /* optional */
  }
  try {
    return require('@playwright/test').chromium;
  } catch {
    /* devDependency */
  }
  return require('playwright-core').chromium;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushLog(logs, seen, type, text) {
  const t = String(text || '').trim();
  if (!t || t.length < 2) return;
  const key = type + '|' + t.slice(0, 240);
  if (seen.has(key)) return;
  seen.add(key);
  logs.push({ type, text: t.slice(0, 500) });
}

/**
 * @param {import('puppeteer').Page} page
 */
async function collectPuppeteerConsoleLogs(page, url, opts) {
  const timeoutMs = opts.timeoutMs || 24_000;
  const waitAfterMs = opts.waitAfterMs != null ? opts.waitAfterMs : 5000;
  const logs = [];
  const seen = new Set();

  page.on('console', (msg) => {
    const t = msg.type();
    const pwType = t === 'warning' ? 'warn' : t === 'log' ? 'info' : t;
    pushLog(logs, seen, pwType, msg.text());
  });
  page.on('pageerror', (err) => {
    pushLog(logs, seen, 'pageerror', String((err && err.message) || err));
  });
  page.on('requestfailed', (request) => {
    const fail = request.failure();
    const hint = (fail && fail.errorText) || 'net::ERR_FAILED';
    pushLog(logs, seen, 'error', `Failed to load resource: ${hint} — ${request.url()}`);
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;
    const u = response.url();
    if (!u || /favicon\.ico|\.woff2?|\.png|\.jpg|\.gif|analytics|google-analytics/i.test(u)) return;
    const rt = response.request().resourceType();
    if (!['document', 'script', 'stylesheet', 'xhr', 'fetch', 'media'].includes(rt)) return;
    let short = u;
    try {
      short = new URL(u).pathname.split('/').pop() || u;
    } catch {
      /* keep */
    }
    pushLog(logs, seen, 'error', `Failed to load resource: the server responded with a status of ${status} (${short})`);
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  try {
    await page.waitForNetworkIdle({ idleTime: 800, timeout: Math.min(12_000, timeoutMs / 2) });
  } catch {
    /* SPA / heavy media */
  }
  await sleep(waitAfterMs);

  let pageStats = { buttonCount: 0, anchorHrefCount: 0, interactiveApprox: 0 };
  try {
    pageStats = await page.evaluate(() => {
      const buttons = document.querySelectorAll(
        'button, [role="button"], input[type="button"], input[type="submit"]'
      ).length;
      const anchors = document.querySelectorAll('a[href]').length;
      const interactive = document.querySelectorAll(
        'button, a[href], [role="button"], input[type="button"], input[type="submit"], [onclick]'
      ).length;
      return {
        buttonCount: buttons,
        anchorHrefCount: anchors,
        interactiveApprox: interactive,
      };
    });
  } catch {
    /* DOM not ready */
  }

  return { logs, pageStats };
}

function loadSparticuzPack() {
  ensureServerlessChromiumEnv();
  try {
    const chromiumPack = require('@sparticuz/chromium');
    return chromiumPack.default || chromiumPack;
  } catch (e) {
    try {
      const chromiumMin = require('@sparticuz/chromium-min');
      return chromiumMin.default || chromiumMin;
    } catch {
      throw e;
    }
  }
}

async function captureWithServerlessPuppeteer(url, opts) {
  const pack = loadSparticuzPack();
  const puppeteer = require('puppeteer-core');

  // Vercel functions have tight time limits; fail fast to avoid "server did not respond in time".
  const timeoutMs = Math.min(Number(opts && opts.timeoutMs) || 24_000, 25_000);
  const waitAfterMs = Math.min(Number(opts && opts.waitAfterMs) || 5000, 4000);

  if (typeof pack.setGraphicsMode === 'function') {
    pack.setGraphicsMode(false);
  }
  if (typeof pack.font === 'function') {
    await pack.font();
  }

  const path = require('path');
  const fs = require('fs');
  const executablePath = await pack.executablePath();
  if (!executablePath) {
    throw new Error('@sparticuz/chromium executablePath() empty');
  }

  const execDir = path.dirname(executablePath);
  const libDirs = [execDir, path.join(execDir, 'lib'), path.join(execDir, 'al2023', 'lib')].filter(
    (d) => {
      try {
        return fs.existsSync(d);
      } catch {
        return false;
      }
    }
  );
  process.env.LD_LIBRARY_PATH = [...libDirs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');

  const launchOpts = {
    args: [...(pack.args || []), '--disable-dev-shm-usage', '--disable-gpu'],
    executablePath,
    headless: typeof pack.headless === 'boolean' ? pack.headless : true,
    ignoreHTTPSErrors: true,
    // Keep protocol + launch time bounded on serverless
    protocolTimeout: 55_000,
  };
  if (pack.defaultViewport) {
    launchOpts.defaultViewport = pack.defaultViewport;
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let browser;
    try {
      browser = await puppeteer.launch({
        ...launchOpts,
        timeout: 35_000,
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );
      const result = await collectPuppeteerConsoleLogs(page, url, { timeoutMs, waitAfterMs });
      await browser.close().catch(() => {});
      return result;
    } catch (e) {
      lastErr = e;
      if (browser) await browser.close().catch(() => {});
      if (attempt === 0) await sleep(600);
    }
  }
  throw lastErr;
}

async function captureWithLocalPlaywright(url, opts) {
  const timeoutMs = opts.timeoutMs || 18_000;
  const waitAfterMs = opts.waitAfterMs != null ? opts.waitAfterMs : 3000;
  const chromium = resolveLocalChromium();
  const browser = await chromium.launch({ headless: true });
  try {
    const logs = await collectPlaywrightConsoleLogs(browser, url, { timeoutMs, waitAfterMs });
    return { logs, pageStats: null };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function collectPlaywrightConsoleLogs(browser, url, opts) {
  const timeoutMs = opts.timeoutMs || 18_000;
  const waitAfterMs = opts.waitAfterMs != null ? opts.waitAfterMs : 3000;
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const logs = [];
  const seen = new Set();

  page.on('console', (msg) => {
    pushLog(logs, seen, msg.type(), msg.text());
  });
  page.on('pageerror', (err) => {
    pushLog(logs, seen, 'pageerror', String((err && err.message) || err));
  });
  page.on('requestfailed', (request) => {
    const fail = request.failure();
    const hint = fail && fail.errorText ? fail.errorText : 'net::ERR_FAILED';
    pushLog(logs, seen, 'error', `Failed to load resource: ${hint} — ${request.url()}`);
  });
  page.on('response', (response) => {
    const status = response.status();
    if (status < 400) return;
    const u = response.url();
    if (!u || /favicon\.ico|\.woff2?|\.png|\.jpg|\.gif|analytics|google-analytics/i.test(u)) return;
    const rt = response.request().resourceType();
    if (!['document', 'script', 'stylesheet', 'xhr', 'fetch', 'media'].includes(rt)) return;
    let short = u;
    try {
      short = new URL(u).pathname.split('/').pop() || u;
    } catch {
      /* keep */
    }
    pushLog(logs, seen, 'error', `Failed to load resource: the server responded with a status of ${status} (${short})`);
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(10_000, timeoutMs / 2) });
  } catch {
    /* SPA */
  }
  await sleep(waitAfterMs);
  await context.close().catch(() => {});
  return logs;
}

function isServerlessChromiumRuntime() {
  if (process.env.GO_LIVE_AUDIT_FORCE_LOCAL_PLAYWRIGHT === '1') return false;
  if (process.env.GO_LIVE_AUDIT_USE_SERVERLESS_CHROMIUM === '1') return true;
  if (process.env.VERCEL === '1') return true;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return true;
  if (process.env.AWS_EXECUTION_ENV) return true;
  if (process.env.LAMBDA_TASK_ROOT) return true;
  return false;
}

async function captureBrowserConsole(url, opts = {}) {
  const target = String(url || '').trim();
  if (!target) return { error: 'No URL', logs: [], pageStats: null };

  const serverless = isServerlessChromiumRuntime();
  const merged = {
    timeoutMs: opts.timeoutMs != null ? opts.timeoutMs : serverless ? 28_000 : 18_000,
    waitAfterMs: opts.waitAfterMs != null ? opts.waitAfterMs : serverless ? 6000 : 3000,
  };

  try {
    if (serverless) {
      const result = await captureWithServerlessPuppeteer(target, merged);
      return {
        logs: result.logs || [],
        pageStats: result.pageStats || null,
        runtime: 'serverless-puppeteer',
      };
    }
    const result = await captureWithLocalPlaywright(target, merged);
    return {
      logs: result.logs || [],
      pageStats: result.pageStats || null,
      runtime: 'local-playwright',
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    // eslint-disable-next-line no-console
    console.warn('[go-live-audit] console capture failed:', msg);
    return { error: msg, logs: [], pageStats: null, runtime: serverless ? 'serverless' : 'local' };
  }
}

module.exports = { captureBrowserConsole, isServerlessChromiumRuntime };
