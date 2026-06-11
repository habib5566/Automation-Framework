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
const coreAlias = path.join(__dirname, '..', 'api', 'go-live-audit-core.js');
fs.copyFileSync(coreSrc, coreAlias);
console.log('Vercel: copied scripts/go-live-audit-core.js → api/_scan-core.js + api/go-live-audit-core.js');

const emailSrc = path.join(__dirname, 'go-live-audit-email-notify.js');
const emailDest = path.join(__dirname, '..', 'api', 'go-live-audit-email-notify.js');
if (!fs.existsSync(emailSrc)) {
  console.error('Missing email notify:', emailSrc);
  process.exit(1);
}
fs.copyFileSync(emailSrc, emailDest);
console.log('Vercel: copied scripts/go-live-audit-email-notify.js → api/go-live-audit-email-notify.js');

const emailPdfSrc = path.join(__dirname, 'go-live-audit-email-pdf.cjs');
const emailPdfDest = path.join(__dirname, '..', 'api', 'go-live-audit-email-pdf.cjs');
if (fs.existsSync(emailPdfSrc)) {
  fs.copyFileSync(emailPdfSrc, emailPdfDest);
  console.log('Vercel: copied scripts/go-live-audit-email-pdf.cjs → api/go-live-audit-email-pdf.cjs');
}

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

for (const name of [
  'go-live-audit-send-json.cjs',
  'go-live-audit-watch-digest-api.cjs',
  'go-live-audit-defaults.cjs',
  'go-live-audit-chromium-env.cjs',
  'go-live-audit-static-console.cjs',
  'go-live-audit-page-issues.cjs',
  'go-live-audit-deep-http-scan.cjs',
  'go-live-audit-playwright-console.cjs',
  'go-live-audit-brand-matrix.cjs',
  'go-live-audit-laravel-version.cjs',
  'go-live-audit-security-threats.cjs',
  'go-live-audit-domain-ssl.cjs',
  'go-live-audit-vulnerabilities.cjs',
  'go-live-audit-brand-watch.cjs',
  'go-live-audit-brands-api.cjs',
  'go-live-audit-watch-run-api.cjs',
  'go-live-audit-watch-runner.cjs',
  'go-live-audit-brand-reports.cjs',
  'go-live-audit-brand-reports-api.cjs',
]) {
  const s = path.join(__dirname, name);
  const d = path.join(__dirname, '..', 'api', name);
  if (!fs.existsSync(s)) {
    console.error('Missing module:', s);
    process.exit(1);
  }
  fs.copyFileSync(s, d);
  console.log('Vercel: copied scripts/' + name + ' → api/' + name);
}
