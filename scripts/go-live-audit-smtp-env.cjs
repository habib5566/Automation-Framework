'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Shared SMTP env bootstrap for go-live-audit-server and go-live-audit-core (Vercel copies this next to _scan-core.js).
 * Order: dotenv (repo-relative paths first — cwd alone misses .env when the shell is not the package root) → infer preset → Mailpit default (only if no auth user).
 */
(function loadDotenvForGoLiveAudit() {
  try {
    const dotenv = require('dotenv');
    const candidates = [
      path.join(__dirname, '..', '.env'),
      path.join(__dirname, '..', 'go-live-audit', '.env'),
      path.join(process.cwd(), '.env'),
    ];
    const seen = new Set();
    let any = false;
    for (const p of candidates) {
      const abs = path.resolve(p);
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (!fs.existsSync(abs)) continue;
      dotenv.config({ path: abs, override: true });
      any = true;
    }
    if (!any) dotenv.config();
  } catch {
    /* optional */
  }
})();

/** Google App Passwords are often pasted with spaces — strip them. */
(function normalizeSmtpPass() {
  const p = process.env.GO_LIVE_AUDIT_SMTP_PASS;
  if (p && typeof p === 'string' && /\s/.test(p)) {
    process.env.GO_LIVE_AUDIT_SMTP_PASS = p.replace(/\s+/g, '');
  }
})();

(function inferSmtpPresetFromSmtpUserDomain() {
  if (String(process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim()) return;
  if (String(process.env.GO_LIVE_AUDIT_SMTP_PRESET || '').trim()) return;
  const user = String(process.env.GO_LIVE_AUDIT_SMTP_USER || '').trim().toLowerCase();
  if (!user || !user.includes('@')) return;
  if (user.endsWith('@gmail.com') || user.endsWith('@googlemail.com')) {
    process.env.GO_LIVE_AUDIT_SMTP_PRESET = 'gmail';
    // eslint-disable-next-line no-console
    console.log('[go-live-audit] Inferred SMTP_PRESET=gmail from GO_LIVE_AUDIT_SMTP_USER domain.');
    return;
  }
  if (
    user.endsWith('@outlook.com') ||
    user.endsWith('@hotmail.com') ||
    user.endsWith('@live.com') ||
    user.endsWith('@msn.com')
  ) {
    process.env.GO_LIVE_AUDIT_SMTP_PRESET = 'outlook';
    // eslint-disable-next-line no-console
    console.log('[go-live-audit] Inferred SMTP_PRESET=outlook from GO_LIVE_AUDIT_SMTP_USER domain.');
  }
})();

/**
 * Optional: GO_LIVE_AUDIT_SMTP_PRESET=gmail|outlook sets host/port when GO_LIVE_AUDIT_SMTP_HOST is unset.
 */
(function applySmtpPresetFromEnv() {
  if (String(process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim()) return;
  const preset = String(process.env.GO_LIVE_AUDIT_SMTP_PRESET || '').trim().toLowerCase();
  if (!preset) return;
  if (preset === 'gmail') {
    process.env.GO_LIVE_AUDIT_SMTP_HOST = 'smtp.gmail.com';
    if (!String(process.env.GO_LIVE_AUDIT_SMTP_PORT || '').trim()) {
      process.env.GO_LIVE_AUDIT_SMTP_PORT = '465';
      process.env.GO_LIVE_AUDIT_SMTP_SECURE = '1';
    } else if (!String(process.env.GO_LIVE_AUDIT_SMTP_SECURE || '').trim()) {
      process.env.GO_LIVE_AUDIT_SMTP_SECURE = process.env.GO_LIVE_AUDIT_SMTP_PORT === '465' ? '1' : '0';
    }
    // eslint-disable-next-line no-console
    console.log(
      '[go-live-audit] SMTP_PRESET=gmail — smtp.gmail.com:' +
        (process.env.GO_LIVE_AUDIT_SMTP_PORT || '465') +
        '. Set GO_LIVE_AUDIT_SMTP_USER + GO_LIVE_AUDIT_SMTP_PASS (Google App Password) + GO_LIVE_AUDIT_EMAIL_FROM.'
    );
    return;
  }
  if (preset === 'outlook' || preset === 'office365') {
    process.env.GO_LIVE_AUDIT_SMTP_HOST = 'smtp.office365.com';
    process.env.GO_LIVE_AUDIT_SMTP_PORT = process.env.GO_LIVE_AUDIT_SMTP_PORT || '587';
    process.env.GO_LIVE_AUDIT_SMTP_SECURE = process.env.GO_LIVE_AUDIT_SMTP_SECURE || '0';
    // eslint-disable-next-line no-console
    console.log(
      '[go-live-audit] SMTP_PRESET=outlook — smtp.office365.com:587. Set GO_LIVE_AUDIT_SMTP_USER + GO_LIVE_AUDIT_SMTP_PASS.'
    );
  }
})();

function isGmailAddress(email) {
  const t = String(email || '').trim().toLowerCase();
  return t.endsWith('@gmail.com') || t.endsWith('@googlemail.com');
}

/**
 * Alert inbox is Gmail → use smtp.gmail.com (not Mailpit). User still needs App Password in .env or UI.
 */
(function applyGmailPresetForGmailAlertInbox() {
  if (process.env.GO_LIVE_AUDIT_NO_DEFAULT_SMTP === '1') return;
  if (String(process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim()) return;
  if (String(process.env.GO_LIVE_AUDIT_SMTP_USER || '').trim()) return;
  let alert = String(process.env.GO_LIVE_AUDIT_ALERT_EMAIL || process.env.GO_LIVE_AUDIT_EMAIL_TO || '').trim();
  if (!alert) {
    try {
      alert = require('./go-live-audit-defaults.cjs').getAlertEmail();
    } catch {
      alert = '';
    }
  }
  if (!isGmailAddress(alert)) return;
  process.env.GO_LIVE_AUDIT_SMTP_PRESET = process.env.GO_LIVE_AUDIT_SMTP_PRESET || 'gmail';
  process.env.GO_LIVE_AUDIT_SMTP_HOST = 'smtp.gmail.com';
  if (!String(process.env.GO_LIVE_AUDIT_SMTP_PORT || '').trim()) {
    process.env.GO_LIVE_AUDIT_SMTP_PORT = '465';
    process.env.GO_LIVE_AUDIT_SMTP_SECURE = '1';
  }
  if (!String(process.env.GO_LIVE_AUDIT_EMAIL_FROM || '').trim()) {
    process.env.GO_LIVE_AUDIT_EMAIL_FROM = alert;
  }
  // eslint-disable-next-line no-console
  console.log(
    '[go-live-audit] Alert email is Gmail — SMTP host smtp.gmail.com:465. Set GO_LIVE_AUDIT_SMTP_PASS in .env (npm run go-live:email-setup) or paste App Password in the scan form.'
  );
})();

/**
 * Local dev: if SMTP host still unset, default to Mailpit — only when no GO_LIVE_AUDIT_SMTP_USER
 * (if USER is set we assume you intend real SMTP; infer + preset should have set host).
 */
(function applyDefaultLocalSmtpIfUnset() {
  if (process.env.GO_LIVE_AUDIT_NO_DEFAULT_SMTP === '1') return;
  if (String(process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim()) return;
  if (String(process.env.GO_LIVE_AUDIT_SMTP_USER || '').trim()) return;
  const cloudish =
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.K_SERVICE ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.FLY_REGION ||
    process.env.DYNO ||
    process.env.RENDER === 'true';
  if (cloudish) return;
  process.env.GO_LIVE_AUDIT_SMTP_HOST = '127.0.0.1';
  if (!String(process.env.GO_LIVE_AUDIT_SMTP_PORT || '').trim()) {
    process.env.GO_LIVE_AUDIT_SMTP_PORT = '1025';
  }
  if (!String(process.env.GO_LIVE_AUDIT_SMTP_SECURE || '').trim()) {
    process.env.GO_LIVE_AUDIT_SMTP_SECURE = '0';
  }
  // eslint-disable-next-line no-console
  console.log(
    '[go-live-audit] SMTP host was unset — using Mailpit defaults 127.0.0.1:1025. For Gmail delivery add GO_LIVE_AUDIT_SMTP_USER + GO_LIVE_AUDIT_SMTP_PASS in .env (preset inferred), or see go-live-audit/EMAIL.md.'
  );
})();
