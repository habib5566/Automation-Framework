/**
 * Minimal Playwright run: open a page, save PNG. Uses PLAYWRIGHT_BROWSERS_PATH if set.
 * Usage (repo root): node scripts/pw-smoke-screenshot.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'reports');
const outPng = path.join(outDir, 'playwright-smoke-screenshot.png');

async function main() {
  const { chromium } = require('playwright-core');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: outPng, fullPage: false });
    // eslint-disable-next-line no-console
    console.log('OK wrote', outPng);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
