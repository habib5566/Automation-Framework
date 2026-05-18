'use strict';

/**
 * SMTP readiness for go-live-audit (used by email-status API and startup logs).
 */
require('./go-live-audit-smtp-env.cjs');
const { envSmtpConfigured, uiSmtpAllowed } = require('./go-live-audit-email-notify');

function smtpHostIsLocalMailpit() {
  const h = String(process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function isGmailAddress(email) {
  const t = String(email || '').trim().toLowerCase();
  return t.endsWith('@gmail.com') || t.endsWith('@googlemail.com');
}

function getEmailConfigStatus() {
  const host = String(process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim();
  const port = String(process.env.GO_LIVE_AUDIT_SMTP_PORT || '').trim();
  const secure = process.env.GO_LIVE_AUDIT_SMTP_SECURE === '1';
  const user = String(process.env.GO_LIVE_AUDIT_SMTP_USER || '').trim();
  const pass = String(process.env.GO_LIVE_AUDIT_SMTP_PASS || '').trim();
  const from = String(process.env.GO_LIVE_AUDIT_EMAIL_FROM || '').trim();
  const mailpit = smtpHostIsLocalMailpit();
  const envPaths = [
    require('path').join(__dirname, '..', '.env'),
    require('path').join(__dirname, '..', 'go-live-audit', '.env'),
  ];
  const fs = require('fs');
  const envFileFound = envPaths.filter((p) => fs.existsSync(p));

  const envReady = envSmtpConfigured();
  const canUseUi = uiSmtpAllowed();

  let ready = envReady;
  let level = envReady ? 'good' : 'bad';
  let headline = envReady ? 'Gmail SMTP ready (.env)' : 'Enter Gmail App Password below';
  let detail = envReady
    ? `Will send via ${host}:${port || (secure ? '465' : '587')} as ${from || user}.`
    : canUseUi
      ? 'Paste your Google App Password in the field below (saved only in this browser). No .env file needed.'
      : 'Configure SMTP in server environment variables (see go-live-audit/EMAIL.md).';
  const steps = envReady
    ? []
    : canUseUi
      ? [
          'Turn on Email scan summary',
          'Report email = your Gmail inbox',
          'Gmail App Password = 16-char password from Google Account (not your normal password)',
          'Run quick scan — report is sent after each scan',
        ]
      : ['Run npm run go-live:email-setup or set SMTP env vars on the host'];

  if (!envReady && mailpit && !user && canUseUi) {
    level = 'bad';
    headline = 'Enter Gmail App Password below';
    detail =
      'Local server uses Mailpit by default. For real Gmail delivery, paste App Password in the form (or run npm run go-live:email-setup once).';
  } else if (user && !pass) {
    detail =
      'GO_LIVE_AUDIT_SMTP_USER is set but GO_LIVE_AUDIT_SMTP_PASS is missing in .env. Run npm run go-live:email-setup again.';
  } else if (user && pass && mailpit && !envReady) {
    detail =
      'SMTP user/password in .env but host is still Mailpit — set GO_LIVE_AUDIT_SMTP_PRESET=gmail or remove Mailpit default; restart server.';
  }

  return {
    ready,
    level,
    headline,
    detail,
    smtp: {
      host: host || null,
      port: port || null,
      secure,
      user: user || null,
      hasPassword: !!pass,
      from: from || user || null,
      mailpit,
    },
    envFiles: envFileFound,
    canDeliverToGmail: envReady || canUseUi,
    uiSmtpAllowed: canUseUi,
    steps,
  };
}

module.exports = { getEmailConfigStatus, smtpHostIsLocalMailpit, isGmailAddress };
