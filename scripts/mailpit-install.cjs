'use strict';

/**
 * Download Mailpit release binary into tools/mailpit/ (gitignored).
 * No Docker required. Run: npm run go-live:mailpit:install
 */
const fs = require('fs');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'tools', 'mailpit');

/** Corporate proxies / SSL inspection: set GO_LIVE_MAILPIT_INSTALL_INSECURE_TLS=1 for this install only. */
function httpsAgent() {
  if (process.env.GO_LIVE_MAILPIT_INSTALL_INSECURE_TLS === '1') {
    return new https.Agent({ rejectUnauthorized: false });
  }
  return undefined;
}

function httpsGetOpts(headers) {
  const o = { headers };
  const agent = httpsAgent();
  if (agent) o.agent = agent;
  return o;
}

function pickAsset(assets) {
  const pl = process.platform;
  const arch = process.arch;
  if (pl === 'win32') {
    const name = arch === 'arm64' ? 'mailpit-windows-arm64.zip' : 'mailpit-windows-amd64.zip';
    return assets.find((a) => a.name === name);
  }
  if (pl === 'darwin') {
    const name = arch === 'arm64' ? 'mailpit-darwin-arm64.tar.gz' : 'mailpit-darwin-amd64.tar.gz';
    return assets.find((a) => a.name === name);
  }
  let name = 'mailpit-linux-amd64.tar.gz';
  if (arch === 'arm64') name = 'mailpit-linux-arm64.tar.gz';
  if (arch === 'arm') name = 'mailpit-linux-arm.tar.gz';
  if (arch === 'ia32') name = 'mailpit-linux-386.tar.gz';
  return assets.find((a) => a.name === name);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    /** New write stream per hop — reusing a closed stream after HTTP redirect breaks the file. */
    const get = (u) => {
      const file = fs.createWriteStream(dest);
      const req = https.get(
        u,
        httpsGetOpts({ 'User-Agent': 'automation-framework-mailpit-install' }),
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            file.close(() => {
              try {
                fs.unlinkSync(dest);
              } catch {
                /* ignore */
              }
              get(new URL(res.headers.location, u).href);
            });
            return;
          }
          if (res.statusCode !== 200) {
            file.close(() => {
              try {
                fs.unlinkSync(dest);
              } catch {
                /* ignore */
              }
              reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            });
            return;
          }
          res.on('error', reject);
          res.pipe(file);
          file.on('finish', () => file.close(() => resolve()));
        }
      );
      req.on('error', (e) => {
        try {
          file.close();
          fs.unlinkSync(dest);
        } catch {
          /* ignore */
        }
        reject(e);
      });
    };
    get(url);
  });
}

function extractZip(zipPath, dest) {
  try {
    execFileSync('tar', ['-xf', zipPath, '-C', dest], { stdio: 'inherit' });
  } catch {
    const z = path.resolve(zipPath).replace(/'/g, "''");
    const d = path.resolve(dest).replace(/'/g, "''");
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${z}' -DestinationPath '${d}' -Force`],
      { stdio: 'inherit' }
    );
  }
}

function extractTarGz(archivePath, dest) {
  execFileSync('tar', ['-xzf', archivePath, '-C', dest], { stdio: 'inherit' });
}

function findBinary(dir, depth) {
  if (depth > 3) return null;
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isFile()) {
      if (ent.name === 'mailpit.exe' || ent.name === 'mailpit') return p;
    } else if (ent.isDirectory() && ent.name !== 'node_modules') {
      const sub = findBinary(p, depth + 1);
      if (sub) return sub;
    }
  }
  return null;
}

async function main() {
  // eslint-disable-next-line no-console
  console.log('[go-live:mailpit:install] Fetching latest Mailpit release from GitHub…');
  const meta = await new Promise((resolve, reject) => {
    const req = https.get(
      'https://api.github.com/repos/axllent/mailpit/releases/latest',
      httpsGetOpts({ 'User-Agent': 'automation-framework-mailpit-install' }),
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
  });

  const asset = pickAsset(meta.assets || []);
  if (!asset) {
    // eslint-disable-next-line no-console
    console.error('[go-live:mailpit:install] No matching asset for', process.platform, process.arch);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const ext = asset.name.endsWith('.zip') ? '.zip' : '.tar.gz';
  const dlPath = path.join(outDir, `_download${ext}`);

  // eslint-disable-next-line no-console
  console.log('[go-live:mailpit:install] Downloading', asset.name, '…');
  await download(asset.browser_download_url, dlPath);
  const dlStat = fs.statSync(dlPath);
  if (dlStat.size < 500000) {
    throw new Error(`Download looks too small (${dlStat.size} bytes); check network or proxy.`);
  }

  for (const ent of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (ent.name.startsWith('mailpit') && ent.isFile() && ent.name !== path.basename(dlPath)) {
      try {
        fs.unlinkSync(path.join(outDir, ent.name));
      } catch {
        /* ignore */
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('[go-live:mailpit:install] Extracting…');
  if (ext === '.zip') {
    extractZip(dlPath, outDir);
  } else {
    extractTarGz(dlPath, outDir);
  }

  try {
    fs.unlinkSync(dlPath);
  } catch {
    /* ignore */
  }

  const bin = findBinary(outDir, 0);
  if (!bin) {
    let listing = '';
    try {
      listing = fs.readdirSync(outDir).join(', ');
    } catch {
      listing = '(unreadable)';
    }
    // eslint-disable-next-line no-console
    console.error('[go-live:mailpit:install] Could not find mailpit binary after extract. Contents:', listing || '(empty)');
    process.exit(1);
  }

  const targetWin = path.join(outDir, 'mailpit.exe');
  const targetNix = path.join(outDir, 'mailpit');
  const target = process.platform === 'win32' ? targetWin : targetNix;
  if (path.resolve(bin) !== path.resolve(target)) {
    fs.copyFileSync(bin, target);
  }
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(target, 0o755);
    } catch {
      /* ignore */
    }
  }

  // eslint-disable-next-line no-console
  console.log('[go-live:mailpit:install] Done. Run: npm run go-live:mailpit');
  // eslint-disable-next-line no-console
  console.log('[go-live:mailpit:install] Web UI: http://localhost:8025');
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[go-live:mailpit:install]', e.message || e);
    const msg = String(e.message || e);
    if (/certificate|TLS|SSL|UNABLE_TO_VERIFY/i.test(msg)) {
      // eslint-disable-next-line no-console
      console.error(
        '  Hint: corporate SSL inspection? Run:\n' +
          '    npm run go-live:mailpit:install:insecure\n' +
          '  (disables TLS verify only for this download — use only if your security policy allows.)'
      );
    }
    process.exit(1);
  });
}
