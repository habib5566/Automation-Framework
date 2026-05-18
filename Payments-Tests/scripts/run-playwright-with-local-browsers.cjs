/**
 * Parent repo `.pw-browsers` use karo (Automation-Framework root) taake ffmpeg/chromium sahi hon.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const paymentsRoot = path.join(__dirname, '..');
const frameworkRoot = path.join(paymentsRoot, '..');
const localBrowsers = path.join(frameworkRoot, '.pw-browsers');

const useLocal =
  fs.existsSync(localBrowsers) && process.env.SKIP_LOCAL_PW_BROWSERS !== '1';
if (useLocal) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}

const cli = require.resolve('@playwright/test/cli', { paths: [paymentsRoot] });
const pwArgs = process.argv.slice(2);
const childEnv = useLocal ? { ...process.env, PLAYWRIGHT_BROWSERS_PATH: localBrowsers } : { ...process.env };
const r = spawnSync(process.execPath, [cli, ...pwArgs], {
  cwd: paymentsRoot,
  stdio: 'inherit',
  env: childEnv,
  windowsHide: true,
});

process.exit(r.status === null ? 1 : r.status);
