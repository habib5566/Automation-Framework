'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function localVendoredBinary(root) {
  const win = path.join(root, 'tools', 'mailpit', 'mailpit.exe');
  const unix = path.join(root, 'tools', 'mailpit', 'mailpit');
  if (process.platform === 'win32' && fs.existsSync(win)) return win;
  if (process.platform !== 'win32' && fs.existsSync(unix)) return unix;
  return null;
}

function mailpitOnPath() {
  const name = process.platform === 'win32' ? 'mailpit.exe' : 'mailpit';
  const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const r = spawnSync(cmd, [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      return r.stdout.split(/\r?\n/)[0].trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {string} root - repo root (parent of scripts/)
 * @returns {import('child_process').ChildProcessWithoutNullStreams}
 */
function startMailpit(root) {
  const fromEnv = String(process.env.GO_LIVE_MAILPIT_BIN || '').trim();
  const exe = fromEnv || localVendoredBinary(root) || mailpitOnPath();
  if (exe) {
    return spawn(exe, [], { cwd: root, stdio: 'inherit', env: process.env });
  }
  return spawn('docker', ['run', '--rm', '-p', '1025:1025', '-p', '8025:8025', 'axllent/mailpit'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
}

module.exports = { startMailpit, localVendoredBinary, mailpitOnPath };
