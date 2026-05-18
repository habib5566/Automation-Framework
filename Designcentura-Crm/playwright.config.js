// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const baseURL = 'https://designcentura.com';
const recordVideo = process.env.PW_RECORD_VIDEO === '1';

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html-report', open: 'never' }],
    ['json', { outputFile: 'reports/playwright-results.json' }],
    ['./reporters/designcentura-reporter.cjs'],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: recordVideo ? 'retain-on-failure' : 'off',
    navigationTimeout: 60_000,
    actionTimeout: 25_000,
    ignoreHTTPSErrors: true,
  },
  expect: { timeout: 20_000 },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'crm-chromium',
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.js/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: path.join(__dirname, 'playwright', '.auth', 'admin.json'),
      },
    },
  ],
});
