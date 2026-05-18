'use strict';
/**
 * Start Mailpit (vendored binary, PATH, or Docker) then the Go-Live Audit server once SMTP port is open.
 *   npm run go-live:audit:with-mailpit
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { startMailpit } = require('./mailpit-process.cjs');

const root = path.join(__dirname, '..');

const mailpit = startMailpit(root);

function waitThenStart(attemptsLeft) {
  const s = net.createConnection({ port: 1025, host: '127.0.0.1' });
  s.on('connect', () => {
    s.end();
    const audit = spawn(process.execPath, [path.join(__dirname, 'go-live-audit-run.cjs')], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    audit.on('exit', (code) => {
      try {
        mailpit.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      process.exit(code == null ? 0 : code);
    });
  });
  s.on('error', () => {
    s.destroy();
    if (attemptsLeft <= 0) {
      // eslint-disable-next-line no-console
      console.error(
        '[go-live-audit] Mailpit did not open port 1025. Try: npm run go-live:mailpit:install  then  npm run go-live:mailpit  — or start Docker.'
      );
      try {
        mailpit.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      process.exit(1);
    }
    setTimeout(() => waitThenStart(attemptsLeft - 1), 400);
  });
}

function shutdown() {
  try {
    mailpit.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
mailpit.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[go-live-audit] Could not start Mailpit:', err.message);
  // eslint-disable-next-line no-console
  console.error('  Run: npm run go-live:mailpit:install   or install Docker Desktop.');
  process.exit(1);
});

// eslint-disable-next-line no-console
console.log('[go-live-audit] Starting Mailpit… then audit UI on http://localhost:3940 — Mailpit UI http://localhost:8025');
waitThenStart(90);
