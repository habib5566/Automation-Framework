'use strict';
/**
 * Same as mailpit-install but disables TLS certificate verification (office SSL inspection only).
 *   npm run go-live:mailpit:install:insecure
 */
process.env.GO_LIVE_MAILPIT_INSTALL_INSECURE_TLS = '1';
const { spawnSync } = require('child_process');
const path = require('path');
const r = spawnSync(process.execPath, [path.join(__dirname, 'mailpit-install.cjs')], { stdio: 'inherit', env: process.env });
process.exit(r.status === null ? 1 : r.status);
