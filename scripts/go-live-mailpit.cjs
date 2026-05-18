'use strict';

/**
 * Run Mailpit on 1025 (SMTP) + 8025 (web). Prefers vendored binary (see mailpit-install),
 * then PATH, then Docker.
 */
const path = require('path');
const { startMailpit } = require('./mailpit-process.cjs');

const root = path.join(__dirname, '..');

if (require.main === module) {
  const child = startMailpit(root);

  child.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[go-live:mailpit] Could not start Mailpit:', err.message);
    // eslint-disable-next-line no-console
    console.error('  Try: npm run go-live:mailpit:install   (downloads Mailpit into tools/mailpit — no Docker)');
    // eslint-disable-next-line no-console
    console.error('  Or install Docker Desktop, or set GO_LIVE_MAILPIT_BIN to your mailpit executable.');
    process.exit(1);
  });
}
