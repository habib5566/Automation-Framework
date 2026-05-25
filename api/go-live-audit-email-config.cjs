'use strict';

/**
 * SMTP readiness for go-live-audit (used by email-status API and startup logs).
 */
require('./go-live-audit-smtp-env.cjs');
const { envSmtpConfigured, uiSmtpAllowed, looksLikeGoogleAppPassword } = require('./go-live-audit-email-notify');

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
  const onVercel = process.env.VERCEL === '1';

  let ready = envReady;
  let level = envReady ? 'good' : 'bad';
  let headline = envReady
    ? 'Gmail SMTP ready (server .env)'
    : onVercel
      ? 'Vercel: add Gmail App Password (env or form)'
      : 'Enter Gmail App Password below';
  let detail = envReady
    ? `Will send via ${host}:${port || (secure ? '465' : '587')} as ${from || user}. Reports go to ${require('./go-live-audit-defaults.cjs').getAlertEmail()}.`
    : onVercel
      ? 'Add GO_LIVE_AUDIT_SMTP_USER + GO_LIVE_AUDIT_SMTP_PASS in Vercel → Settings → Environment Variables (see go-live-audit/VERCEL-EMAIL-SETUP.md), Redeploy — OR paste App Password below (saved in this browser).'
      : canUseUi
        ? 'Paste your Google App Password in the field below (saved only in this browser). No .env file needed.'
        : 'Configure SMTP in server environment variables (see go-live-audit/EMAIL.md).';
  const steps = envReady
    ? ['After each scan, email goes to ' + require('./go-live-audit-defaults.cjs').getAlertEmail()]
    : onVercel
      ? [
          'Vercel → Project → Settings → Environment Variables → Production',
          'GO_LIVE_AUDIT_SMTP_USER = your Gmail (the account that created the App Password)',
          'GO_LIVE_AUDIT_SMTP_PASS = 16-character Google App Password (not normal password)',
          'GO_LIVE_AUDIT_EMAIL_FROM = same Gmail address',
          'Redeploy, then run a scan (Email scan summary is on by default)',
        ]
      : canUseUi
        ? [
            'Keep Email scan summary checked',
            'Paste Gmail App Password below (16 chars, no spaces)',
            'Run quick scan — report goes to habib.developer8899@gmail.com',
          ]
        : ['Run: npm run go-live:email-setup', 'Restart: npm run go-live:audit'];

  if (!envReady && onVercel && !user) {
    ready = false;
    level = 'bad';
    headline = 'Vercel: Gmail password not in server env';
    detail =
      'Set GO_LIVE_AUDIT_SMTP_USER and GO_LIVE_AUDIT_SMTP_PASS in Vercel Environment Variables, then Redeploy — or paste App Password in the form below.';
  } else if (!envReady && mailpit && !user && canUseUi) {
    level = 'bad';
    headline = 'Enter Gmail App Password below';
    detail =
      'Local server uses Mailpit by default. For real Gmail delivery, paste App Password in the form (or run npm run go-live:email-setup once).';
  } else if (host && host.includes('gmail.com') && !pass) {
    ready = false;
    level = 'bad';
    headline = 'Gmail App Password missing';
    detail =
      'Server uses smtp.gmail.com but no password in .env. Run npm run go-live:email-setup OR paste App Password in the scan form.';
  } else if (user && !pass) {
    detail =
      'GO_LIVE_AUDIT_SMTP_USER is set but GO_LIVE_AUDIT_SMTP_PASS is missing in .env. Run npm run go-live:email-setup again.';
  } else if (user && pass && mailpit && !envReady) {
    detail =
      'SMTP user/password in .env but host is still Mailpit — set GO_LIVE_AUDIT_SMTP_PRESET=gmail or remove Mailpit default; restart server.';
  } else if (envReady && pass && !looksLikeGoogleAppPassword(pass)) {
    ready = false;
    level = 'bad';
    headline = '.env password is not a Google App Password';
    detail =
      'GO_LIVE_AUDIT_SMTP_PASS looks like a normal Gmail password (App Passwords are 16 letters/numbers, no @). Run npm run go-live:email-setup again, or paste App Password in the scan form.';
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
