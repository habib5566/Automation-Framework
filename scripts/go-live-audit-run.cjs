'use strict';
/**
 * Start go-live-audit-server with Node's system CA store when supported (fixes many
 * corporate SSL-inspection setups on Windows without disabling verification).
 * @see go-live-audit/TUNNEL.md — tunnel script spawns this file.
 */
const { spawn } = require('child_process');
const path = require('path');

const main = path.join(__dirname, 'go-live-audit-server.js');
const [maj, min] = process.versions.node.split('.').map(Number);
const systemCaOk = maj > 20 || (maj === 20 && min >= 6);
const args = [...(systemCaOk ? ['--use-system-ca'] : []), main];
const child = spawn(process.execPath, args, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code == null ? 0 : code);
});
