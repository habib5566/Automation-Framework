/**
 * Optional post-scan email (SMTP). Used by go-live-audit-core after each scan.
 * Default recipient: GO_LIVE_AUDIT_ALERT_EMAIL or habib.developer8899@gmail.com (see go-live-audit-defaults.cjs).
 * @see go-live-audit/EMAIL.md
 */
const { getAlertEmail } = require('./go-live-audit-defaults.cjs');

const DEFAULT_FROM_DISPLAY_NAME = 'Go Live Check List';

function getEmailFromDisplayName() {
  const n = String(process.env.GO_LIVE_AUDIT_EMAIL_FROM_NAME || '').trim();
  return n || DEFAULT_FROM_DISPLAY_NAME;
}

/** Nodemailer From — object form is most reliable for inbox display name. */
function buildFromField(email, displayName) {
  const addr = String(email || '').trim();
  if (!addr || !addr.includes('@')) {
    return { name: DEFAULT_FROM_DISPLAY_NAME, address: 'go-live-audit@localhost' };
  }
  const name = String(displayName || getEmailFromDisplayName()).trim() || DEFAULT_FROM_DISPLAY_NAME;
  return { name: name.replace(/[\r\n"]/g, ' ').trim(), address: addr };
}

function isLikelyEmail(s) {
  const t = String(s || '').trim();
  if (t.length < 6 || t.length > 254 || /[\s;,]/.test(t)) return false;
  const at = t.indexOf('@');
  if (at < 1 || at !== t.lastIndexOf('@')) return false;
  const dom = t.slice(at + 1);
  if (!dom.includes('.') || dom.startsWith('.') || dom.endsWith('.')) return false;
  return true;
}

/** Typed Report email is allowed unless the deployer sets GO_LIVE_AUDIT_DISALLOW_UI_RECIPIENT=1 (public APIs). */
function recipientFromUiAllowed() {
  return process.env.GO_LIVE_AUDIT_DISALLOW_UI_RECIPIENT !== '1';
}

function resolveRecipient(requestJson) {
  const alertTo = getAlertEmail();
  if (isLikelyEmail(alertTo)) {
    return { to: alertTo, mode: 'alert' };
  }

  const envTo = (process.env.GO_LIVE_AUDIT_EMAIL_TO || '').trim();
  const uiRaw = String(requestJson.reportEmail || requestJson.emailTo || requestJson.userEmail || '').trim();
  if (uiRaw && !isLikelyEmail(uiRaw)) {
    return {
      to: '',
      mode: 'skip',
      reason:
        'Report email looks invalid — use a full address like name@gmail.com (include @ and a domain with a dot, e.g. .com).',
    };
  }
  const uiValid = uiRaw && isLikelyEmail(uiRaw);
  const canUi = recipientFromUiAllowed();

  if (canUi && uiValid) return { to: uiRaw, mode: 'ui' };
  if (envTo) return { to: envTo, mode: 'env' };
  return {
    to: '',
    mode: 'skip',
    reason: 'No alert email configured.',
  };
}

function buildPlainText(scanResponse) {
  const o = scanResponse || {};
  const lines = [];
  lines.push(getEmailFromDisplayName() + ' — website scan report');
  lines.push('Time (UTC): ' + new Date().toISOString());
  if (o.brandName) lines.push('Brand: ' + o.brandName);
  if (o.vulnerabilities && Array.isArray(o.vulnerabilities.items) && o.vulnerabilities.items.length) {
    const v = o.vulnerabilities;
    lines.push('');
    lines.push('═══ VULNERABILITIES & RISKS ═══');
    lines.push('Summary: ' + (v.headline || '—'));
    lines.push(
      'Counts — critical: ' +
        (v.summary && v.summary.critical) +
        ', high: ' +
        (v.summary && v.summary.high) +
        ', medium: ' +
        (v.summary && v.summary.medium) +
        ', low: ' +
        (v.summary && v.summary.low)
    );
    for (const item of v.items.slice(0, 40)) {
      lines.push(
        '  [' +
          (item.severity || '?').toUpperCase() +
          '] ' +
          (item.category || '') +
          ' — ' +
          (item.title || '') +
          (item.detail ? ' — ' + item.detail : '')
      );
    }
    lines.push('');
  }
  if (o.security) {
    const sec = o.security;
    lines.push('');
    lines.push('═══ SECURITY MONITOR ═══');
    lines.push('Alert level: ' + (sec.alertLevel || 'ok').toUpperCase());
    lines.push('Summary: ' + (sec.headline || '—'));
    lines.push('Critical: ' + (sec.criticalCount || 0) + ' | Warnings: ' + (sec.warnCount || 0));
    if (sec.baselineDrift && sec.baselineDrift.changed) {
      lines.push('Baseline drift: page changed vs last clean scan');
      lines.push('  Was: ' + (sec.baselineDrift.previousTitle || '—'));
      lines.push('  Now: ' + (sec.baselineDrift.currentTitle || '—'));
    }
    if (Array.isArray(sec.threats) && sec.threats.length) {
      lines.push('');
      lines.push('Threats / attack signals:');
      for (const t of sec.threats) {
        lines.push('  [' + (t.severity || '?').toUpperCase() + '] ' + (t.kind || '') + ' — ' + (t.message || ''));
      }
    }
    lines.push('');
  }
  if (o.brandMatrix) {
    const m = o.brandMatrix;
    lines.push('');
    lines.push('Brand performance matrix');
    lines.push('  Performance rate: ' + m.performancePercent + '% (grade ' + m.performanceGrade + ')');
    if (m.passRatePercent != null) lines.push('  Checklist pass rate: ' + m.passRatePercent + '%');
    for (const row of m.matrix || []) {
      lines.push('  ' + row.label + ': ' + row.value);
    }
    if (m.frameworks && m.frameworks.length) {
      lines.push('  Frameworks / stack:');
      for (const f of m.frameworks) {
        lines.push('    · ' + f.label + (f.version ? ' ' + f.version : ' (version not exposed)'));
      }
    }
  }
  if (o.siteStack && o.siteStack.items && o.siteStack.items.length && !(o.brandMatrix && o.brandMatrix.frameworks && o.brandMatrix.frameworks.length)) {
    lines.push('');
    lines.push('Site technology stack:');
    for (const it of o.siteStack.items.slice(0, 14)) {
      lines.push('  · ' + it.label + (it.version ? ' ' + it.version : ''));
    }
  }
  lines.push('');
  if (o.consoleIssues && o.consoleIssues.items && o.consoleIssues.items.length) {
    lines.push('Browser console errors (' + o.consoleIssues.items.length + '):');
    for (const it of o.consoleIssues.items) {
      lines.push('  [' + (it.severity || 'error').toUpperCase() + '] ' + (it.message || ''));
    }
    lines.push('');
  }
  if (o.pageIssues && o.pageIssues.summary) {
    const s = o.pageIssues.summary;
    lines.push('Issues summary: ' + s.errors + ' error(s), ' + s.warns + ' warning(s)');
    lines.push('');
  }
  if (Array.isArray(o.pageIssues && o.pageIssues.items) && o.pageIssues.items.length) {
    lines.push('Detected issues (site / console / HTTP):');
    for (const it of o.pageIssues.items) {
      lines.push('  [' + (it.severity || '?').toUpperCase() + '] ' + (it.kind || '') + ' — ' + (it.message || ''));
    }
    lines.push('');
  }
  lines.push('Requested URL: ' + (o.requestedUrl || '—'));
  if (o.finalUrl) lines.push('Final URL: ' + o.finalUrl);
  if (o.statusCode != null) lines.push('HTTP status: ' + o.statusCode);
  if (o.contentType) lines.push('Content-Type: ' + o.contentType);
  if (o.xRobotsTag != null && o.xRobotsTag !== '') lines.push('X-Robots-Tag: ' + o.xRobotsTag);
  if (o.availability) {
    const a = o.availability;
    lines.push('Availability: ' + (a.headline || a.state || '—'));
    if (a.detail) lines.push('  ' + String(a.detail).replace(/\s+/g, ' ').trim());
  }
  if (o.error) lines.push('Fetch error: ' + o.error);
  if (o.overallSummary) {
    const s = o.overallSummary;
    lines.push('');
    lines.push('Overall: ' + (s.headline || '—'));
    if (s.subline) lines.push('  ' + s.subline);
    if (s.level) lines.push('  Level: ' + s.level);
    if (s.counts) {
      lines.push(
        '  Auto rows — pass: ' +
          (s.counts.pass || 0) +
          ', fail: ' +
          (s.counts.fail || 0) +
          ', pending: ' +
          (s.counts.pending || 0) +
          ', n/a: ' +
          (s.counts.notScored || 0)
      );
    }
  }
  if (Array.isArray(o.autoChecks) && o.autoChecks.length) {
    lines.push('');
    lines.push('Auto checklist (' + o.autoChecks.length + ' rows):');
    for (const ac of o.autoChecks) {
      if (!ac) continue;
      lines.push('  • ' + ac.id + ' → ' + ac.status + (ac.note ? ' — ' + ac.note : ''));
    }
  }
  if (Array.isArray(o.scanWarnings) && o.scanWarnings.length) {
    lines.push('');
    lines.push('Scan warnings:');
    for (const w of o.scanWarnings) {
      if (w && w.message) lines.push('  — ' + w.message);
    }
  }
  if (o.robotsTxt && o.robotsTxt.fetched) {
    lines.push('');
    lines.push('robots.txt: HTTP ' + (o.robotsTxt.status != null ? o.robotsTxt.status : '—'));
    lines.push('  Sitemap line: ' + (o.robotsTxt.hasSitemapLine ? 'yes' : 'no'));
    if (o.robotsTxt.error) lines.push('  Error: ' + o.robotsTxt.error);
    if (o.robotsTxt.preview) {
      lines.push('  Preview (truncated):');
      lines.push(String(o.robotsTxt.preview).slice(0, 800).replace(/\r/g, ''));
    }
  }
  if (o.scanMeta && (o.scanMeta.followUpPagesFetched || 0) > 0) {
    lines.push('');
    lines.push('Follow-up pages merged: ' + o.scanMeta.followUpPagesFetched);
    for (const u of o.scanMeta.followUpPageUrls || []) {
      lines.push('  ' + u);
    }
  }
  if (o.disclaimer) {
    lines.push('');
    lines.push('Disclaimer:');
    lines.push(o.disclaimer);
  }
  if (o.htmlSignals && typeof o.htmlSignals === 'object') {
    lines.push('');
    lines.push('--- HTML / page signals (JSON) ---');
    let j;
    try {
      j = JSON.stringify(o.htmlSignals, null, 2);
    } catch {
      j = String(o.htmlSignals);
    }
    lines.push(j.slice(0, 22_000) + (j.length > 22_000 ? '\n… [truncated]' : ''));
  }
  lines.push('');
  lines.push('— Sent by Automation-Framework go-live-audit');
  return lines.join('\n');
}

function escapeHtmlForEmail(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtmlEmail(scanResponse, opts) {
  opts = opts || {};
  const brand = scanResponse && scanResponse.brandName ? escapeHtmlForEmail(scanResponse.brandName) : '';
  const title = getEmailFromDisplayName();
  const os = scanResponse && scanResponse.overallSummary;
  const summaryLine = os
    ? escapeHtmlForEmail((os.headline || '') + (os.subline ? ' — ' + os.subline : ''))
    : 'Scan completed.';
  const pdfNote = opts.pdfAttached
    ? '<p style="margin:0 0 12px;padding:10px 12px;background:#ecfdf5;border:1px solid #86efac;border-radius:6px;color:#166534;font-size:14px"><strong>PDF report attached</strong> — please open the PDF for the complete go-live audit (summary, performance, risks, security, and checklist).</p>'
    : '';
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"/></head>' +
    '<body style="font-family:Segoe UI,Calibri,Arial,sans-serif;background:#f4f6f8;margin:0;padding:20px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px">' +
    '<tr><td style="padding:16px 20px;background:#1e3a5f;color:#ffffff;font-size:18px;font-weight:600">' +
    escapeHtmlForEmail(title) +
    (brand ? ' — ' + brand : '') +
    '</td></tr>' +
    '<tr><td style="padding:16px 20px;color:#334155;font-size:14px;line-height:1.55">' +
    pdfNote +
    '<p style="margin:0 0 8px;font-size:15px;line-height:1.5"><strong>' +
    summaryLine +
    '</strong></p>' +
    (brand ? '<p style="margin:0;color:#64748b">Brand: ' + brand + '</p>' : '') +
    '</td></tr>' +
    '<tr><td style="padding:12px 20px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b">' +
    'Automated website check · Reply not monitored · Mark as not spam if this lands in Junk' +
    '</td></tr></table></body></html>'
  );
}

function buildSubject(scanResponse) {
  const o = scanResponse || {};
  let host = '';
  try {
    host = new URL(o.finalUrl || o.requestedUrl || 'http://x').hostname;
  } catch {
    host = (o.requestedUrl || '').slice(0, 60);
  }
  const brand = o.brandName ? String(o.brandName).trim().slice(0, 40) : '';
  const head = (o.overallSummary && o.overallSummary.headline) || (o.ok === false ? 'Scan incomplete' : 'Scan complete');
  let short = String(head).replace(/\s+/g, ' ').trim().slice(0, 60);
  if (o.vulnerabilities && o.vulnerabilities.summary && o.vulnerabilities.summary.critical > 0) {
    short =
      (o.vulnerabilities.summary.critical || 0) +
      ' critical finding(s) — ' +
      (o.vulnerabilities.headline || short);
  } else if (o.security && o.security.alertLevel === 'critical') {
    short = 'Security review needed — ' + short;
  } else if (o.security && o.security.shouldAlert) {
    short = 'Security notice — ' + short;
  } else if (o.pageIssues && o.pageIssues.summary && o.pageIssues.summary.errors > 0) {
    short = (o.pageIssues.summary.errors || 0) + ' issue(s) found — ' + short;
  }
  const prefix = brand ? brand + ' — ' : 'Website scan — ';
  return prefix + host + ' — ' + short;
}

/** Critical / high-risk scan — email even if user forgot the checkbox. */
function scanNeedsDangerEmail(scanResponse) {
  const o = scanResponse || {};
  if (process.env.GO_LIVE_AUDIT_ALERT_ON_THREAT === '0') return false;
  if (o.ok === false && o.availability) return true;
  if (o.securityAlert === true) return true;
  if (o.security && o.security.shouldAlert) return true;
  if (o.security && o.security.alertLevel === 'critical') return true;
  const vs = o.vulnerabilities && o.vulnerabilities.summary;
  if (vs && (Number(vs.critical) > 0 || Number(vs.high) >= 2)) return true;
  const pi = o.pageIssues && o.pageIssues.summary;
  if (pi && Number(pi.errors) >= 4) return true;
  if (o.overallSummary && o.overallSummary.level === 'bad') return true;
  return false;
}

function shouldSendForRequest(requestJson, scanResponse) {
  if (!requestJson || requestJson.skipEmail === true) return { ok: false, reason: 'skipEmail' };
  const always = process.env.GO_LIVE_AUDIT_EMAIL_ALWAYS === '1';
  const asked =
    requestJson.sendEmail === true ||
    requestJson.emailReport === true ||
    requestJson.email === true;
  const danger = scanNeedsDangerEmail(scanResponse);
  if (!always && !asked && !danger) {
    return {
      ok: false,
      reason: 'sendEmail not checked and no danger alert — tick Email scan summary or set GO_LIVE_AUDIT_EMAIL_ALWAYS=1',
    };
  }
  const expected = (process.env.GO_LIVE_AUDIT_NOTIFY_TOKEN || '').trim();
  if (expected) {
    const got = String(requestJson.notifyToken || '').trim();
    if (got !== expected) return { ok: false, reason: 'notifyToken mismatch or missing' };
  }
  return { ok: true, danger };
}

function smtpHostIsLocalMailpit() {
  const h = String(process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/** When Report email is Gmail, Mailpit cannot deliver — require real SMTP in .env. */
function reportEmailRequiresInternetSmtp(to) {
  const t = String(to || '').trim().toLowerCase();
  return t.endsWith('@gmail.com') || t.endsWith('@googlemail.com');
}

const GMAIL_SMTP_REQUIRED_MSG =
  '[GMAIL_SMTP_REQUIRED] To receive the report in Gmail: enter your Google App Password in the form below (saved only in this browser), or run npm run go-live:email-setup once. See go-live-audit/EMAIL.md.';

function uiSmtpAllowed() {
  if (process.env.GO_LIVE_AUDIT_DISALLOW_UI_SMTP === '1') return false;
  if (process.env.GO_LIVE_AUDIT_ALLOW_UI_SMTP === '1') return true;
  const cloudish =
    process.env.VERCEL === '1' ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.K_SERVICE ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.FLY_REGION ||
    process.env.DYNO ||
    process.env.RENDER === 'true';
  return !cloudish;
}

function normalizeAppPassword(pass) {
  return String(pass || '').trim().replace(/\s+/g, '');
}

/** Google App Passwords are 16 chars, no @ — normal Gmail passwords fail SMTP with 535. */
function looksLikeGoogleAppPassword(pass) {
  const p = normalizeAppPassword(pass);
  if (p.length < 16) return false;
  if (/[@\s]/.test(p)) return false;
  return /^[a-z0-9]+$/i.test(p);
}

const NOT_APP_PASSWORD_HINT =
  'GO_LIVE_AUDIT_SMTP_PASS must be a Google App Password (16 letters/numbers, no @). Normal Gmail passwords do not work. Google Account → Security → 2-Step Verification → App passwords, or run npm run go-live:email-setup.';

/** Gmail App Password from scan request (no .env needed on local server). */
function smtpFromRequestBody(requestJson) {
  if (!uiSmtpAllowed() || !requestJson) return null;
  const user = String(requestJson.smtpUser || requestJson.gmailUser || '').trim();
  const pass = normalizeAppPassword(requestJson.smtpPass || requestJson.gmailAppPassword || '');
  if (!user || !pass) return null;
  const host = String(requestJson.smtpHost || 'smtp.gmail.com').trim();
  const port = Number(requestJson.smtpPort || 465);
  const secure = requestJson.smtpSecure != null ? requestJson.smtpSecure === true || requestJson.smtpSecure === '1' : port === 465;
  const fromEmail = String(requestJson.smtpFrom || requestJson.emailFrom || user).trim();
  return { host, port, secure, user, pass, fromEmail, source: 'ui' };
}

function envSmtpConfigured() {
  const host = (process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim();
  const user = (process.env.GO_LIVE_AUDIT_SMTP_USER || '').trim();
  const pass = String(process.env.GO_LIVE_AUDIT_SMTP_PASS || '').trim();
  return !!(host && user && pass && !smtpHostIsLocalMailpit());
}

function smtpTlsOptions(host) {
  const tls = { minVersion: 'TLSv1.2' };
  const h = String(host || '').toLowerCase();
  const insecure =
    process.env.GO_LIVE_AUDIT_SMTP_TLS_REJECT_UNAUTHORIZED === '0' ||
    process.env.GO_LIVE_AUDIT_SMTP_TLS_INSECURE === '1';
  if (insecure || h.includes('gmail.com')) {
    tls.rejectUnauthorized = false;
  }
  return tls;
}

function createNodemailerTransport(cfg) {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    return { error: 'nodemailer not installed (npm install nodemailer)' };
  }
  const opts = {
    host: cfg.host,
    port: cfg.port,
    secure: !!cfg.secure,
    tls: smtpTlsOptions(cfg.host),
  };
  if (cfg.user) opts.auth = { user: cfg.user, pass: cfg.pass };
  return { transport: nodemailer.createTransport(opts), cfg };
}

async function sendMailWithGmailFallback(transport, mail, cfg) {
  try {
    await transport.sendMail(mail);
    return { ok: true };
  } catch (e) {
    const msg = String((e && e.message) || e);
    const isGmail = String(cfg.host || '').toLowerCase().includes('gmail');
    const certFail = /certificate|UNABLE_TO_VERIFY|self[- ]signed|TLS/i.test(msg);
    if (!isGmail) throw e;

    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch {
      throw e;
    }

    if (cfg.port === 465 || cfg.secure) {
      try {
        const t587 = nodemailer.createTransport({
          host: cfg.host || 'smtp.gmail.com',
          port: 587,
          secure: false,
          auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
          tls: smtpTlsOptions(cfg.host),
          requireTLS: true,
        });
        await t587.sendMail(mail);
        return { ok: true, usedPort587: true };
      } catch (e2) {
        if (!certFail) throw e2;
      }
    }

    if (certFail) {
      const relaxed = nodemailer.createTransport({
        host: cfg.host || 'smtp.gmail.com',
        port: cfg.port || 465,
        secure: cfg.secure !== false,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: false },
      });
      await relaxed.sendMail(mail);
      return { ok: true, usedRelaxedTls: true };
    }
    throw e;
  }
}

function createTransportFromEnv() {
  const host = (process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim();
  if (!host) return { error: 'GO_LIVE_AUDIT_SMTP_HOST not set' };
  const user = (process.env.GO_LIVE_AUDIT_SMTP_USER || '').trim();
  const pass = String(process.env.GO_LIVE_AUDIT_SMTP_PASS || '').trim();
  const localish = smtpHostIsLocalMailpit();
  if (!localish && (!user || !pass)) {
    return {
      error:
        '[GMAIL_SMTP_REQUIRED] Set GO_LIVE_AUDIT_SMTP_USER + GO_LIVE_AUDIT_SMTP_PASS in .env (npm run go-live:email-setup) or paste Gmail App Password in the scan form.',
    };
  }
  if (user && !pass) {
    return {
      error:
        'GO_LIVE_AUDIT_SMTP_PASS is empty — add App Password in the form below or run npm run go-live:email-setup.',
    };
  }
  return createNodemailerTransport({
    host,
    port: Number(process.env.GO_LIVE_AUDIT_SMTP_PORT || 587),
    secure: process.env.GO_LIVE_AUDIT_SMTP_SECURE === '1',
    user,
    pass,
    fromEmail:
      (process.env.GO_LIVE_AUDIT_EMAIL_FROM || '').trim() ||
      user ||
      'go-live-audit@localhost',
    source: 'env',
  });
}

function resolveTransport(requestJson, to) {
  const ui = smtpFromRequestBody(requestJson);
  const needsInternet = reportEmailRequiresInternetSmtp(to);
  const envPass = normalizeAppPassword(process.env.GO_LIVE_AUDIT_SMTP_PASS || '');
  const envApp = looksLikeGoogleAppPassword(envPass);
  const uiApp = ui ? looksLikeGoogleAppPassword(ui.pass) : false;

  if (ui && uiApp && needsInternet) {
    return createNodemailerTransport(ui);
  }

  if (envSmtpConfigured()) {
    const envT = createTransportFromEnv();
    if (!envT.error) {
      if (needsInternet && envPass && !envApp) {
        if (ui) return createNodemailerTransport(ui);
        return { error: NOT_APP_PASSWORD_HINT };
      }
      return envT;
    }
  }
  if (needsInternet && ui) {
    return createNodemailerTransport(ui);
  }
  if (ui) {
    return createNodemailerTransport(ui);
  }
  if (needsInternet && smtpHostIsLocalMailpit()) {
    return {
      error:
        '[GMAIL_SMTP_REQUIRED] Gmail inbox needs Google App Password — paste it in the scan form (Gmail App Password field) or run: npm run go-live:email-setup',
    };
  }
  const envT = createTransportFromEnv();
  if (!envT.error) return envT;
  if (envT.error && String(envT.error).includes('[GMAIL_SMTP_REQUIRED]')) {
    return { error: envT.error };
  }
  if (needsInternet) {
    return {
      error:
        '[GMAIL_SMTP_REQUIRED] Paste Gmail App Password in the scan form or run npm run go-live:email-setup, then restart npm run go-live:audit.',
    };
  }
  return { error: 'No SMTP — add Gmail App Password in the form or run npm run go-live:email-setup.' };
}

/**
 * @param {Record<string, unknown>} requestJson Parsed POST body (for skipEmail / notifyToken).
 * @param {Record<string, unknown>} scanResponse Same object sent to the browser as JSON.
 * @returns {Promise<{ skipped?: boolean, reason?: string, sent?: boolean, error?: string, recipientMode?: string }>}
 */
async function maybeSendScanEmail(requestJson, scanResponse) {
  const gate = shouldSendForRequest(requestJson, scanResponse);
  if (!gate.ok) return { skipped: true, reason: gate.reason };

  const resolved = resolveRecipient(requestJson);
  if (!resolved.to) {
    return { skipped: true, reason: resolved.reason || 'No recipient' };
  }

  const uiSmtp = smtpFromRequestBody(requestJson);
  if (
    process.env.GO_LIVE_AUDIT_ALLOW_MAILPIT_FOR_GMAIL !== '1' &&
    reportEmailRequiresInternetSmtp(resolved.to) &&
    smtpHostIsLocalMailpit() &&
    !envSmtpConfigured() &&
    !uiSmtp
  ) {
    return { skipped: true, reason: GMAIL_SMTP_REQUIRED_MSG };
  }

  const t = resolveTransport(requestJson, resolved.to);
  if (t.error) {
    // eslint-disable-next-line no-console
    console.warn('[go-live-audit] email:', t.error);
    if (String(t.error).includes('[GMAIL_SMTP_REQUIRED]')) {
      return { skipped: true, reason: t.error };
    }
    return { error: t.error };
  }

  const fromEmail =
    (t.cfg && t.cfg.fromEmail) ||
    (process.env.GO_LIVE_AUDIT_EMAIL_FROM || '').trim() ||
    (process.env.GO_LIVE_AUDIT_SMTP_USER || '').trim() ||
    (t.cfg && t.cfg.user) ||
    'go-live-audit@localhost';

  const fromField = buildFromField(fromEmail, getEmailFromDisplayName());
  let pdfAttachment = null;
  try {
    const { buildScanReportPdf } = require('./go-live-audit-email-pdf.cjs');
    pdfAttachment = await buildScanReportPdf(scanResponse);
  } catch (pdfErr) {
    // eslint-disable-next-line no-console
    console.warn('[go-live-audit] PDF report skipped:', String((pdfErr && pdfErr.message) || pdfErr).slice(0, 120));
  }

  const mail = {
    from: fromField,
    sender: fromField,
    to: resolved.to,
    subject: buildSubject(scanResponse),
    text:
      buildPlainText(scanResponse) +
      (pdfAttachment
        ? '\n\n— A PDF version of this report is attached to this email.\n'
        : '\n\n— PDF attachment was not generated on this run.\n'),
    html: buildHtmlEmail(scanResponse, { pdfAttached: !!pdfAttachment }),
    replyTo: fromField,
    headers: {
      'X-Mailer': 'Go-Live-Check-List',
      'Auto-Submitted': 'auto-generated',
    },
  };
  if (pdfAttachment && pdfAttachment.buffer) {
    mail.attachments = [
      {
        filename: pdfAttachment.filename,
        content: pdfAttachment.buffer,
        contentType: 'application/pdf',
      },
    ];
  }

  try {
    const sendMeta = await sendMailWithGmailFallback(t.transport, mail, t.cfg || {});
    const smtpHost = String((t.cfg && t.cfg.host) || process.env.GO_LIVE_AUDIT_SMTP_HOST || '')
      .trim()
      .toLowerCase();
    const localish = smtpHost === '127.0.0.1' || smtpHost === 'localhost' || smtpHost === '::1';
    if (localish && reportEmailRequiresInternetSmtp(resolved.to)) {
      return {
        skipped: true,
        reason:
          '[GMAIL_SMTP_REQUIRED] Mailpit captured the message locally — it was NOT sent to ' +
          resolved.to +
          '. Paste Gmail App Password in the form or run npm run go-live:email-setup, then restart npm run go-live:audit.',
        mailpitOnly: true,
      };
    }
    // eslint-disable-next-line no-console
    console.log('[go-live-audit] email sent (' + resolved.mode + ') to', resolved.to.split(/[,;]/).map((s) => s.trim()).join(', '));
    /** @type {{ sent: true, recipientMode: string, sentTo: string, deliveryHint?: string }} */
    const out = { sent: true, recipientMode: resolved.mode, sentTo: resolved.to };
    if (sendMeta.usedPort587) {
      out.deliveryHint = 'Sent via Gmail on port 587 (465 failed). Check inbox and spam for ' + resolved.to + '.';
    } else if (sendMeta.usedRelaxedTls) {
      out.deliveryHint =
        'Sent via Gmail (corporate TLS workaround). Check inbox and spam for ' + resolved.to + '.';
    } else if (t.cfg && t.cfg.source === 'ui') {
      out.deliveryHint =
        'Delivered via Gmail. Inbox shows “' +
        getEmailFromDisplayName() +
        '” if Google Account name matches — see go-live-audit/EMAIL-SENDER-NAME.md. Check inbox and spam for ' +
        resolved.to +
        '.';
    } else if (localish) {
      out.deliveryHint =
        'SMTP is local Mailpit only — open http://localhost:8025 on this PC. For real Gmail, run npm run go-live:email-setup.';
    } else {
      out.deliveryHint = 'Sent via ' + smtpHost + '. Check inbox and spam for ' + resolved.to + '.';
    }
    if (pdfAttachment && pdfAttachment.filename) {
      out.pdfAttached = true;
      out.pdfFilename = pdfAttachment.filename;
      out.deliveryHint = (out.deliveryHint || '') + ' PDF report attached: ' + pdfAttachment.filename;
    }
    return out;
  } catch (e) {
    const msg = String((e && e.message) || e);
    // eslint-disable-next-line no-console
    console.warn('[go-live-audit] email send failed:', msg);

    const smtpHost = String(process.env.GO_LIVE_AUDIT_SMTP_HOST || '').trim().toLowerCase();
    const localish = smtpHost === '127.0.0.1' || smtpHost === 'localhost' || smtpHost === '::1';
    const connFail = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|Connection refused/i.test(msg);
    const fileOk = process.env.GO_LIVE_AUDIT_NO_EMAIL_FILE_FALLBACK !== '1' && localish && connFail;

    if (fileOk) {
      try {
        const fs = require('fs');
        const path = require('path');
        const outPath = path.join(__dirname, '..', 'go-live-audit', 'public', 'last-scan-email-report.txt');
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, buildPlainText(scanResponse), 'utf8');
        // eslint-disable-next-line no-console
        console.log('[go-live-audit] wrote fallback report to', outPath);
        return {
          savedLocal: true,
          downloadPath: '/last-scan-email-report.txt',
          hint: 'SMTP (Mailpit) unreachable — full text report saved on the server. Open the link in this UI host or start Mailpit and resend.',
        };
      } catch (writeErr) {
        return {
          error: msg + ' (could not write fallback file: ' + String((writeErr && writeErr.message) || writeErr) + ')',
        };
      }
    }

    if (/Invalid login|535|EAUTH|authentication failed/i.test(msg)) {
      return { error: msg, reason: NOT_APP_PASSWORD_HINT };
    }
    return { error: msg };
  }
}

module.exports = {
  maybeSendScanEmail,
  scanNeedsDangerEmail,
  looksLikeGoogleAppPassword,
  buildPlainText,
  buildSubject,
  isLikelyEmail,
  resolveRecipient,
  envSmtpConfigured,
  uiSmtpAllowed,
  smtpFromRequestBody,
};
