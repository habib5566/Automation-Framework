/**
 * Copy Go-Live Audit static assets into repo-root `public/` for Vercel.
 * Run automatically via package.json "build" when deploying.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'go-live-audit', 'public');
const dest = path.join(__dirname, '..', 'public');

if (!fs.existsSync(src)) {
  console.error('Missing source:', src);
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Vercel: copied go-live-audit/public → public/');

/** Serverless bundle only traces `api/` — copy scan core next to `api/scan.js` for Vercel. */
const coreSrc = path.join(__dirname, 'go-live-audit-core.js');
const coreDest = path.join(__dirname, '..', 'api', '_scan-core.js');
if (!fs.existsSync(coreSrc)) {
  console.error('Missing scan core:', coreSrc);
  process.exit(1);
}
fs.copyFileSync(coreSrc, coreDest);
console.log('Vercel: copied scripts/go-live-audit-core.js → api/_scan-core.js');

const emailSrc = path.join(__dirname, 'go-live-audit-email-notify.js');
const emailDest = path.join(__dirname, '..', 'api', 'go-live-audit-email-notify.js');
if (!fs.existsSync(emailSrc)) {
  console.error('Missing email notify:', emailSrc);
  process.exit(1);
}
fs.copyFileSync(emailSrc, emailDest);
console.log('Vercel: copied scripts/go-live-audit-email-notify.js → api/go-live-audit-email-notify.js');

const smtpEnvSrc = path.join(__dirname, 'go-live-audit-smtp-env.cjs');
const smtpEnvDest = path.join(__dirname, '..', 'api', 'go-live-audit-smtp-env.cjs');
if (!fs.existsSync(smtpEnvSrc)) {
  console.error('Missing SMTP env bootstrap:', smtpEnvSrc);
  process.exit(1);
}
fs.copyFileSync(smtpEnvSrc, smtpEnvDest);
console.log('Vercel: copied scripts/go-live-audit-smtp-env.cjs → api/go-live-audit-smtp-env.cjs');

const rtSrc = path.join(__dirname, 'go-live-audit-runtime-info.cjs');
const rtDest = path.join(__dirname, '..', 'api', 'go-live-audit-runtime-info.cjs');
if (!fs.existsSync(rtSrc)) {
  console.error('Missing runtime info:', rtSrc);
  process.exit(1);
}
fs.copyFileSync(rtSrc, rtDest);
console.log('Vercel: copied scripts/go-live-audit-runtime-info.cjs → api/go-live-audit-runtime-info.cjs');

const stackSrc = path.join(__dirname, 'go-live-audit-site-stack.cjs');
const stackDest = path.join(__dirname, '..', 'api', 'go-live-audit-site-stack.cjs');
if (!fs.existsSync(stackSrc)) {
  console.error('Missing site stack detector:', stackSrc);
  process.exit(1);
}
fs.copyFileSync(stackSrc, stackDest);
console.log('Vercel: copied scripts/go-live-audit-site-stack.cjs → api/go-live-audit-site-stack.cjs');

const emailCfgSrc = path.join(__dirname, 'go-live-audit-email-config.cjs');
const emailCfgDest = path.join(__dirname, '..', 'api', 'go-live-audit-email-config.cjs');
if (!fs.existsSync(emailCfgSrc)) {
  console.error('Missing email config:', emailCfgSrc);
  process.exit(1);
}
fs.copyFileSync(emailCfgSrc, emailCfgDest);
console.log('Vercel: copied scripts/go-live-audit-email-config.cjs → api/go-live-audit-email-config.cjs');
