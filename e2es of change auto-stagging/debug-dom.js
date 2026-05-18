const { chromium } = require('playwright-core');
const path = require('path');
(async () => {
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: path.join(__dirname, 'auth.json') });
    const page = await context.newPage();
    await page.goto('https://staging-dashboard.autobotx.ai/vetted-logos/users', { waitUntil: 'networkidle' });
    console.log('URL', page.url());
    const html = await page.content();
    console.log('BODY START', html.slice(0, 2000).replace(/\n/g, ' '));
    await browser.close();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
