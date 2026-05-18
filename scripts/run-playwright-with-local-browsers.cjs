/**
 * PLAYWRIGHT_BROWSERS_PATH ko Playwright load hone se *pehle* set karta hai
 * (warna registry galat ffmpeg path cache kar leta hai — User PATH mein broken ffmpeg-6.0).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const localBrowsers = path.join(root, '.pw-browsers');

const useLocal =
  fs.existsSync(localBrowsers) && process.env.SKIP_LOCAL_PW_BROWSERS !== '1';
if (useLocal) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}

const cli = require.resolve('@playwright/test/cli');
const pwArgs = process.argv.slice(2);
const childEnv = useLocal ? { ...process.env, PLAYWRIGHT_BROWSERS_PATH: localBrowsers } : { ...process.env };
const r = spawnSync(process.execPath, [cli, ...pwArgs], {
  cwd: root,
  stdio: 'inherit',
  env: childEnv,
  windowsHide: true,
});

process.exit(r.status === null ? 1 : r.status);
