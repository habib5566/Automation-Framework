// @ts-check
const fs = require('fs');
const path = require('path');
/** Prefer project-local browsers (fixes broken User PATH entries like ...\ffmpeg-6.0\ffmpeg-6.0). */
const localBrowsers = path.join(__dirname, '.pw-browsers');
if (fs.existsSync(localBrowsers) && process.env.SKIP_LOCAL_PW_BROWSERS !== '1') {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}

const { defineConfig, devices } = require('@playwright/test');
require('dotenv').config();

const demoURL = 'http://localhost:3789';
const baseURL = process.env.BASE_URL || demoURL;
const stagingDefault = 'https://staging-dashboard.autobotx.ai';
function isLocalDemoServerUrl(url) {
  try {
    const u = new URL(url);
    return u.port === '3789' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}
const startDemoWebServer = !process.env.SKIP_WEB_SERVER && isLocalDemoServerUrl(baseURL);

// Video requires Playwright's ffmpeg (`npx playwright install ffmpeg`). Custom PLAYWRIGHT_BROWSERS_PATH
// or a missing binary often causes ENOENT. Set PW_RECORD_VIDEO=1 to enable; default is off.
const recordVideo = process.env.PW_RECORD_VIDEO === '1';

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : Number(process.env.PW_RETRIES ?? 1),
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: 'reports/html-report',
        open: 'never',
      },
    ],
    ['json', { outputFile: 'reports/test-results.json' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: recordVideo ? 'retain-on-failure' : 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], baseURL },
    },
    {
      name: 'staging-autobotx',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.STAGING_BASE_URL || stagingDefault,
        navigationTimeout: 45_000,
        actionTimeout: 20_000,
      },
    },
  ],
  ...(startDemoWebServer
    ? {
        webServer: {
          command: `"${process.execPath}" "${path.join(__dirname, 'fixtures', 'server.js')}"`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }
    : {}),
});
