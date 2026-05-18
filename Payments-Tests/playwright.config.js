// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const baseURL = 'https://designcentura.com';

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html-report', open: 'never' }],
    ['json', { outputFile: 'reports/playwright-results.json' }],
    ['./reporters/payment-reporter.cjs'],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: { mode: 'on', fullPage: true },
    video: 'retain-on-failure',
    navigationTimeout: 60_000,
    actionTimeout: 25_000,
    ignoreHTTPSErrors: true,
  },
  expect: { timeout: 25_000 },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'payments',
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.js/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'playwright', '.auth', 'admin.json'),
      },
    },
  ],
});
