/**
 * Optional post-scan email (SMTP). Used by go-live-audit-core after each scan.
 * Default recipient: GO_LIVE_AUDIT_ALERT_EMAIL or munem.developer@gmail.com (see go-live-audit-defaults.cjs).
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
  if (o.domainSsl) {
    const ds = o.domainSsl;
    lines.push('');
    lines.push('═══ SSL & DOMAIN EXPIRY ═══');
    lines.push('Summary: ' + (ds.headline || '—'));
    if (ds.hostname) lines.push('Host: ' + ds.hostname);
    for (const it of (ds.items || [])) {
      const extra =
        it.type === 'ssl' && it.validTo
          ? ' (until ' + it.validTo.slice(0, 10) + ')'
          : it.type === 'domain' && it.expiresAt
            ? ' (until ' + it.expiresAt.slice(0, 10) + ')'
            : it.error
              ? ' — ' + it.error
              : '';
      lines.push(
        '  [' +
          (it.severity || (it.ok === false ? 'info' : 'ok')).toUpperCase() +
          '] ' +
          (it.type || 'check') +
          ' — ' +
          (it.headline || '—') +
          extra
      );
    }
    lines.push('');
  }
  if (o.attackSurface) {
    const as = o.attackSurface;
    lines.push('');
    lines.push('═══ ATTACK SURFACE & PENTEST-STYLE CHECKS ═══');
    lines.push('Summary: ' + (as.headline || '—'));
    if (as.score != null) lines.push('Security posture score: ' + as.score + '/100');
    for (const cat of as.categories || []) {
      lines.push('');
      lines.push('— ' + (cat.label || cat.id || 'Category') + ' —');
      for (const f of (cat.findings || []).slice(0, 12)) {
        lines.push(
          '  [' +
            (f.severity || '?').toUpperCase() +
            '] ' +
            (f.title || '') +
            (f.remediation ? ' · Fix: ' + f.remediation : '')
        );
      }
    }
    if (as.scopeNote) lines.push('Note: ' + as.scopeNote);
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

function buildAttackSurfaceHtmlBlock(attackSurface) {
  const as = attackSurface;
  if (!as) return '';
  const alertStyle = as.shouldAlert
    ? 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b'
    : 'background:#f8fafc;border:1px solid #e2e8f0;color:#334155';
  let catsHtml = '';
  for (const cat of (as.categories || []).slice(0, 6)) {
    let items = '';
    for (const f of (cat.findings || []).slice(0, 4)) {
      items +=
        '<li style="margin:3px 0">[' +
        escapeHtmlForEmail(String(f.severity || '').toUpperCase()) +
        '] ' +
        escapeHtmlForEmail(f.title || '') +
        '</li>';
    }
    if (items) {
      catsHtml +=
        '<p style="margin:8px 0 2px;font-weight:600">' +
        escapeHtmlForEmail(cat.label || '') +
        '</p><ul style="margin:0 0 6px 18px;padding:0;font-size:12px">' +
        items +
        '</ul>';
    }
  }
  return (
    '<div style="margin:12px 0;padding:10px 12px;' +
    alertStyle +
    ';border-radius:6px;font-size:13px;line-height:1.45">' +
    '<strong>Attack surface checks</strong>' +
    (as.score != null ? ' · Score ' + escapeHtmlForEmail(String(as.score)) + '/100' : '') +
    '<br/>' +
    escapeHtmlForEmail(as.headline || '—') +
    catsHtml +
    '</div>'
  );
}

function buildDomainSslHtmlBlock(domainSsl) {
  const ds = domainSsl;
  if (!ds) return '';
  const alertStyle = ds.shouldAlert
    ? 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b'
    : 'background:#f0fdf4;border:1px solid #bbf7d0;color:#166534';
  let itemsHtml = '';
  for (const it of ds.items || []) {
    const label = it.type === 'domain' ? 'Domain' : 'SSL';
    const extra =
      it.type === 'ssl' && it.validTo
        ? ' (until ' + it.validTo.slice(0, 10) + ')'
        : it.type === 'domain' && it.expiresAt
          ? ' (until ' + it.expiresAt.slice(0, 10) + ')'
          : it.error
            ? ' — ' + it.error
            : '';
    itemsHtml +=
      '<li style="margin:4px 0">' +
      escapeHtmlForEmail(label + ' — ' + (it.headline || '—') + extra) +
      '</li>';
  }
  return (
    '<div style="margin:12px 0;padding:10px 12px;' +
    alertStyle +
    ';border-radius:6px;font-size:13px;line-height:1.45">' +
    '<strong>SSL &amp; domain expiry</strong><br/>' +
    escapeHtmlForEmail(ds.headline || '—') +
    (itemsHtml ? '<ul style="margin:8px 0 0 18px;padding:0">' + itemsHtml + '</ul>' : '') +
    '</div>'
  );
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
    ? '<p style="margin:0 0 12px;padding:10px 12px;background:#ecfdf5;border:1px solid #86efac;border-radius:6px;color:#166534;font-size:14px"><strong>PDF report attached</strong> — please open the PDF for the complete go-live audit (summary, performance, SSL/domain expiry, risks, security, and checklist).</p>'
    : '';
  const domainSslBlock = buildDomainSslHtmlBlock(scanResponse && scanResponse.domainSsl);
  const attackSurfaceBlock = buildAttackSurfaceHtmlBlock(scanResponse && scanResponse.attackSurface);
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
    domainSslBlock +
    attackSurfaceBlock +
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
  } else if (o.domainSsl && o.domainSsl.shouldAlert) {
    short = 'SSL/domain renewal — ' + short;
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
  if (o.domainSsl && o.domainSsl.shouldAlert) return true;
  if (o.attackSurface && o.attackSurface.shouldAlert) return true;
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

/** Full scan JSON for digest PDF/email (same fields as single-scan; no huge HTML blobs). */
function compactScanPayloadForDigest(result) {
  const r = result || {};
  if (!r || typeof r !== 'object') return null;
  const pageItems = (r.pageIssues && r.pageIssues.items) || [];
  return {
    ok: r.ok !== false,
    brandName: r.brandName || null,
    requestedUrl: r.requestedUrl || null,
    finalUrl: r.finalUrl || null,
    statusCode: r.statusCode != null ? r.statusCode : null,
    contentType: r.contentType || null,
    availability: r.availability || null,
    overallSummary: r.overallSummary || null,
    brandMatrix: r.brandMatrix || null,
    vulnerabilities: r.vulnerabilities || null,
    domainSsl: r.domainSsl || null,
    attackSurface: r.attackSurface || null,
    security: r.security || null,
    autoChecks: Array.isArray(r.autoChecks) ? r.autoChecks.slice(0, 80) : [],
    pageIssues: {
      items: pageItems.slice(0, 40),
      summary: (r.pageIssues && r.pageIssues.summary) || { errors: 0, warns: 0, total: 0 },
    },
    consoleIssues: r.consoleIssues || null,
    siteStack: r.siteStack
      ? Object.assign({}, r.siteStack, {
          items: (r.siteStack.items || []).slice(0, 20),
        })
      : null,
    scanMeta: r.scanMeta || null,
    robotsTxt: r.robotsTxt || null,
    scanWarnings: (r.scanWarnings || []).slice(0, 30),
    xRobotsTag: r.xRobotsTag != null ? r.xRobotsTag : null,
    disclaimer: r.disclaimer || null,
  };
}

/** Accept compact rows or raw { scanPayload } from browser watch (same path as quick scan). */
function normalizeDigestEntries(entries) {
  const raw = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const out = [];
  for (const e of raw) {
    if (!e) continue;
    if (e.scanPayload && typeof e.scanPayload === 'object' && !e.performancePercent) {
      const sp = e.scanPayload;
      const brand = {
        name: sp.brandName || e.brandName,
        url: sp.requestedUrl || e.url,
      };
      out.push(buildWatchDigestEntry(brand, sp));
      continue;
    }
    if (e.scanPayload && typeof e.scanPayload === 'object') {
      const row = Object.assign({}, e);
      row.scanPayload = compactScanPayloadForDigest(e.scanPayload);
      out.push(row);
      continue;
    }
    out.push(e);
  }
  return out;
}

/** Compact row for combined “all brands” watch email. */
function buildWatchDigestEntry(brand, result) {
  const { brandStorageKey } = require('./go-live-audit-brand-reports.cjs');
  const r = result || {};
  const b = brand || {};
  const os = r.overallSummary || {};
  const av = r.availability || {};
  const bm = r.brandMatrix || {};
  const sec = r.security || {};
  const dss = r.domainSsl || {};
  const asurf = r.attackSurface || {};
  const sm = r.scanMeta || {};
  return {
    brandName: r.brandName || b.name || '—',
    url: b.url || r.requestedUrl || r.finalUrl || '—',
    requestedUrl: r.requestedUrl || b.url || '—',
    finalUrl: r.finalUrl || null,
    ok: r.ok !== false,
    statusCode: r.statusCode != null ? r.statusCode : null,
    availabilityHeadline: av.headline || av.state || '—',
    availabilityState: av.state || null,
    siteUp: av.state === 'up' || (r.statusCode >= 200 && r.statusCode < 400),
    overallHeadline: os.headline || '—',
    overallLevel: os.level || null,
    performancePercent: bm.performancePercent != null ? bm.performancePercent : null,
    performanceGrade: bm.performanceGrade || null,
    siteHealthPercent: bm.siteHealthPercent != null ? bm.siteHealthPercent : null,
    checklistPercent: bm.checklistPercent != null ? bm.checklistPercent : null,
    passRatePercent: bm.passRatePercent != null ? bm.passRatePercent : null,
    pass: (os.counts && os.counts.pass) || 0,
    fail: (os.counts && os.counts.fail) || 0,
    pending: (os.counts && os.counts.pending) || 0,
    securityWarns: sec.warnCount || 0,
    securityHeadline: sec.headline || null,
    securityAlert: !!(sec.shouldAlert || sec.alertLevel === 'critical'),
    domainSslHeadline: dss.headline || null,
    domainSslAlert: !!dss.shouldAlert,
    attackSurfaceHeadline: asurf.headline || null,
    attackSurfaceScore: asurf.score != null ? asurf.score : null,
    attackSurfaceAlert: !!asurf.shouldAlert,
    criticalCount: sec.criticalCount || 0,
    consoleCapture: sm.consoleCapture || null,
    error: r.error ? String(r.error).slice(0, 200) : null,
    reportKey: brandStorageKey(r.brandName || b.name, b.url || r.requestedUrl),
    scanPayload: compactScanPayloadForDigest(r),
  };
}

/** Build scan JSON for per-brand PDF (full stored report preferred). */
function scanPayloadForDigestPdf(entry, storedReport) {
  if (storedReport && storedReport.payload && typeof storedReport.payload === 'object') {
    return storedReport.payload;
  }
  const e = entry || {};
  return {
    ok: e.ok !== false,
    brandName: e.brandName,
    requestedUrl: e.requestedUrl || e.url,
    finalUrl: e.finalUrl || null,
    statusCode: e.statusCode != null ? e.statusCode : null,
    overallSummary: {
      headline: e.overallHeadline || '—',
      level: e.overallLevel || null,
      counts: { pass: e.pass || 0, fail: e.fail || 0, pending: e.pending || 0 },
    },
    brandMatrix: {
      performancePercent: e.performancePercent,
      performanceGrade: e.performanceGrade,
      siteHealthPercent: e.siteHealthPercent,
      checklistPercent: e.checklistPercent,
      passRatePercent: e.passRatePercent,
    },
    availability: {
      headline: e.availabilityHeadline,
      state: e.availabilityState,
    },
    security: {
      headline: e.securityHeadline,
      warnCount: e.securityWarns || 0,
      criticalCount: e.criticalCount || 0,
    },
    domainSsl: e.scanPayload && e.scanPayload.domainSsl ? e.scanPayload.domainSsl : null,
    scanMeta: { consoleCapture: e.consoleCapture || null },
  };
}

/**
 * One professional PDF per brand (same as single-scan email attachment).
 * @returns {Promise<Array<{ filename: string, content: Buffer, contentType: string }>>}
 */
async function buildWatchPerBrandPdfAttachments(entries) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!list.length) return [];
  const { buildScanReportPdf } = require('./go-live-audit-email-pdf.cjs');
  const { loadBrandReport } = require('./go-live-audit-brand-reports.cjs');
  const out = [];
  for (const e of list) {
    if (!e) continue;
    let stored = null;
    try {
      stored = await loadBrandReport(e.reportKey || e.brandName);
    } catch {
      stored = null;
    }
    const payload =
      e.scanPayload && typeof e.scanPayload === 'object'
        ? e.scanPayload
        : scanPayloadForDigestPdf(e, stored);
    try {
      const pdf = await buildScanReportPdf(payload);
      if (pdf && pdf.buffer && pdf.filename) {
        out.push({
          filename: pdf.filename,
          content: pdf.buffer,
          contentType: 'application/pdf',
        });
      }
    } catch (pdfErr) {
      // eslint-disable-next-line no-console
      console.warn(
        '[go-live-audit] digest PDF skipped for',
        e.brandName || '—',
        String((pdfErr && pdfErr.message) || pdfErr).slice(0, 80)
      );
    }
  }
  return out;
}

function buildWatchDigestSubject(entries) {
  const n = (entries || []).length;
  const alerts = (entries || []).filter((e) => e && e.securityAlert).length;
  const down = (entries || []).filter((e) => e && !e.siteUp && e.ok).length;
  let tail = 'all OK';
  if (alerts > 0) tail = alerts + ' alert(s)';
  else if (down > 0) tail = down + ' need attention';
  return getEmailFromDisplayName() + ' — Watch report — ' + n + ' brand(s) — ' + tail;
}

function buildWatchDigestPlainText(entries) {
  const list = entries || [];
  const lines = [];
  lines.push(getEmailFromDisplayName() + ' — combined watch report (all brands)');
  lines.push('Time (UTC): ' + new Date().toISOString());
  lines.push('Brands scanned: ' + list.length);
  lines.push(
    'Security alerts: ' +
      list.filter((e) => e && e.securityAlert).length +
      ' · Sites not up: ' +
      list.filter((e) => e && e.ok && !e.siteUp).length
  );
  lines.push('');
  lines.push('════════════════════════════════════════');
  for (const e of list) {
    lines.push('');
    lines.push('▸ ' + (e.brandName || '—'));
    lines.push('  URL: ' + (e.url || '—'));
    if (!e.ok) {
      lines.push('  Scan: FAILED — ' + (e.error || 'unknown error'));
      continue;
    }
    lines.push('  HTTP: ' + (e.statusCode != null ? e.statusCode : '—') + ' · ' + (e.availabilityHeadline || '—'));
    if (e.performancePercent != null) {
      lines.push('  Site score: ' + e.performancePercent + '% (grade ' + (e.performanceGrade || '—') + ')');
      if (e.siteHealthPercent != null || e.checklistPercent != null) {
        lines.push(
          '  Breakdown: HTTP health ' +
            (e.siteHealthPercent != null ? e.siteHealthPercent + '%' : '—') +
            ' · Checklist pass ' +
            (e.checklistPercent != null ? e.checklistPercent + '%' : e.passRatePercent != null ? e.passRatePercent + '%' : '—')
        );
      }
    }
    lines.push('  Overall: ' + (e.overallHeadline || '—'));
    lines.push(
      '  Checklist: Pass ' +
        (e.pass || 0) +
        ' · Fail ' +
        (e.fail || 0) +
        ' · Manual review ' +
        (e.pending || 0)
    );
    if (e.securityHeadline) lines.push('  Security: ' + e.securityHeadline);
    if (e.domainSslHeadline) lines.push('  SSL/Domain: ' + e.domainSslHeadline);
    if (e.attackSurfaceHeadline) {
      lines.push(
        '  Attack surface: ' +
          e.attackSurfaceHeadline +
          (e.attackSurfaceScore != null ? ' (score ' + e.attackSurfaceScore + '/100)' : '')
      );
    }
    if (e.securityAlert) lines.push('  ⚠ SECURITY ALERT — review this brand');
    if (e.domainSslAlert) lines.push('  ⚠ SSL/DOMAIN RENEWAL ALERT — review this brand');
    if (e.attackSurfaceAlert) lines.push('  ⚠ ATTACK SURFACE ALERT — review this brand');
    if (e.scanPayload && typeof e.scanPayload === 'object') {
      lines.push('  (Full detail in attached PDF for this brand.)');
    }
  }
  lines.push('');
  lines.push('— End of combined watch report. Each brand has its own PDF attached (same style as single-brand scan).');
  return lines.join('\n');
}

function buildWatchDigestHtml(entries) {
  const list = entries || [];
  const alertN = list.filter((e) => e && e.securityAlert).length;
  let rows = '';
  for (const e of list) {
    const status = !e.ok
      ? '<span style="color:#b91c1c">Scan failed</span>'
      : e.siteUp
        ? '<span style="color:#15803d">Up</span>'
        : '<span style="color:#c2410c">Check URL</span>';
    const score =
      e.performancePercent != null
        ? escapeHtmlForEmail(String(e.performancePercent)) +
          '% · ' +
          escapeHtmlForEmail(e.performanceGrade || '—') +
          (e.checklistPercent != null
            ? '<br/><span style="font-size:11px;color:#64748b">Checklist ' +
              escapeHtmlForEmail(String(e.checklistPercent)) +
              '% · HTTP ' +
              escapeHtmlForEmail(e.siteHealthPercent != null ? String(e.siteHealthPercent) : '—') +
              '%</span>'
            : '')
        : '—';
    rows +=
      '<tr><td style="padding:8px 10px;border-bottom:1px solid #e2e8f0"><strong>' +
      escapeHtmlForEmail(e.brandName || '—') +
      '</strong><br/><span style="font-size:12px;color:#64748b">' +
      escapeHtmlForEmail(e.url || '—') +
      '</span></td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">' +
      status +
      '<br/>HTTP ' +
      escapeHtmlForEmail(e.statusCode != null ? String(e.statusCode) : '—') +
      '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">' +
      score +
      '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px">' +
      escapeHtmlForEmail((e.overallHeadline || '—').slice(0, 120)) +
      (e.securityAlert ? '<br/><span style="color:#b91c1c">⚠ Security alert</span>' : '') +
      (e.domainSslHeadline
        ? '<br/><span style="font-size:11px;color:#64748b">SSL/Domain: ' +
          escapeHtmlForEmail(e.domainSslHeadline.slice(0, 80)) +
          '</span>'
        : '') +
      (e.domainSslAlert ? '<br/><span style="color:#b91c1c">⚠ SSL/domain renewal</span>' : '') +
      '</td></tr>';
  }
  const summaryTable =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px">' +
    '<tr><td style="padding:16px 20px;background:#1e3a5f;color:#fff;font-size:18px;font-weight:600">' +
    escapeHtmlForEmail(getEmailFromDisplayName()) +
    ' — All brands watch report</td></tr>' +
    '<tr><td style="padding:16px 20px;color:#334155;font-size:14px">' +
    '<p style="margin:0 0 8px"><strong>' +
    list.length +
    ' brand(s)</strong> scanned in one watch run.' +
    (alertN ? ' <span style="color:#b91c1c">' + alertN + ' security alert(s).</span>' : '') +
    '</p></td></tr>' +
    '<tr><td style="padding:0 12px 16px">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">' +
    '<thead><tr style="background:#f1f5f9"><th style="text-align:left;padding:8px 10px">Brand</th><th style="text-align:left;padding:8px 10px">Status</th><th style="text-align:left;padding:8px 10px">Score</th><th style="text-align:left;padding:8px 10px">Summary</th></tr></thead>' +
    '<tbody>' +
    rows +
    '</tbody></table></td></tr>' +
    '<tr><td style="padding:12px 20px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b">Automated watch · Check spam if missing</td></tr></table>';

  let detailBlocks = '';
  for (const e of list) {
    if (!e || !e.scanPayload || typeof e.scanPayload !== 'object') continue;
    const sp = e.scanPayload;
    const os = sp.overallSummary || {};
    detailBlocks +=
      '<div style="max-width:720px;margin:12px auto 0;padding:14px 18px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;color:#334155">' +
      '<p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#1e3a5f">' +
      escapeHtmlForEmail(e.brandName || 'Brand') +
      '</p>' +
      '<p style="margin:0 0 4px">' +
      escapeHtmlForEmail(sp.requestedUrl || e.url || '—') +
      '</p>' +
      '<p style="margin:0 0 6px">' +
      escapeHtmlForEmail((os.headline || '—').slice(0, 200)) +
      (e.performancePercent != null
        ? ' · Score <strong>' + escapeHtmlForEmail(String(e.performancePercent)) + '%</strong>'
        : '') +
      ' · See attached PDF for full checklist.</p>' +
      (sp.domainSsl && sp.domainSsl.headline
        ? '<p style="margin:0;font-size:13px;color:#475569"><strong>SSL/Domain:</strong> ' +
          escapeHtmlForEmail(sp.domainSsl.headline) +
          '</p>'
        : e.domainSslHeadline
          ? '<p style="margin:0;font-size:13px;color:#475569"><strong>SSL/Domain:</strong> ' +
            escapeHtmlForEmail(e.domainSslHeadline) +
            '</p>'
          : '') +
      '</div>';
  }
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:Segoe UI,Calibri,Arial,sans-serif;background:#f4f6f8;margin:0;padding:20px">' +
    summaryTable +
    detailBlocks +
    '</body></html>'
  );
}

/**
 * One email after all brands in a watch run (not per-brand).
 * @param {Record<string, unknown>} requestJson SMTP + recipient from watch UI
 * @param {Array<Record<string, unknown>>} entries from buildWatchDigestEntry
 */
async function maybeSendWatchDigestEmail(requestJson, entries) {
  const list = normalizeDigestEntries(entries);
  if (!list.length) return { skipped: true, reason: 'No brands in digest' };

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
    return t.error.includes('[GMAIL_SMTP_REQUIRED]') ? { skipped: true, reason: t.error } : { error: t.error };
  }

  const fromEmail =
    (t.cfg && t.cfg.fromEmail) ||
    (process.env.GO_LIVE_AUDIT_EMAIL_FROM || '').trim() ||
    (process.env.GO_LIVE_AUDIT_SMTP_USER || '').trim() ||
    (t.cfg && t.cfg.user) ||
    'go-live-audit@localhost';
  const fromField = buildFromField(fromEmail, getEmailFromDisplayName());

  let pdfAttachments = [];
  let pdfOmittedBySize = 0;
  try {
    const allPdfs = await buildWatchPerBrandPdfAttachments(list);
    let totalBytes = 0;
    const capped = [];
    for (const att of allPdfs) {
      const n = att.content && att.content.length ? att.content.length : 0;
      if (totalBytes + n > 22 * 1024 * 1024) break;
      totalBytes += n;
      capped.push(att);
    }
    pdfOmittedBySize = allPdfs.length - capped.length;
    pdfAttachments = capped;
    if (pdfOmittedBySize > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[go-live-audit] watch digest PDFs capped for Gmail size:',
        capped.length + '/' + allPdfs.length
      );
    }
  } catch (pdfErr) {
    // eslint-disable-next-line no-console
    console.warn('[go-live-audit] watch digest PDFs skipped:', String((pdfErr && pdfErr.message) || pdfErr).slice(0, 100));
  }

  const pdfCount = pdfAttachments.length;
  const mail = {
    from: fromField,
    sender: fromField,
    to: resolved.to,
    subject: buildWatchDigestSubject(list),
    text:
      buildWatchDigestPlainText(list) +
      (pdfCount
        ? '\n\n— ' + pdfCount + ' PDF report(s) attached (one per brand, same as single scan).\n'
        : ''),
    html:
      buildWatchDigestHtml(list) +
      (pdfCount
        ? '<p style="margin:12px 0 0;font-size:13px;color:#166534"><strong>' +
          pdfCount +
          ' PDF(s) attached</strong> — one full scan report per brand.</p>'
        : ''),
    replyTo: fromField,
    headers: { 'X-Mailer': 'Go-Live-Check-List-Watch-Digest', 'Auto-Submitted': 'auto-generated' },
  };
  if (pdfAttachments.length) {
    mail.attachments = pdfAttachments;
  }

  try {
    const sendMeta = await sendMailWithGmailFallback(t.transport, mail, t.cfg || {});
    // eslint-disable-next-line no-console
    console.log(
      '[go-live-audit] watch digest email sent to',
      resolved.to,
      '(' + list.length + ' brands,',
      pdfCount,
      'PDF(s))'
    );
    return {
      sent: true,
      digest: true,
      brandCount: list.length,
      pdfCount,
      pdfFilenames: pdfAttachments.map((a) => a.filename),
      recipientMode: resolved.mode,
      sentTo: resolved.to,
      deliveryHint:
        'Combined watch report for ' +
        list.length +
        ' brand(s) with ' +
        pdfCount +
        ' PDF attachment(s)' +
        (pdfCount < list.length
          ? ' (' +
            (list.length - pdfCount) +
            ' PDF(s) not attached — Gmail ~22MB limit or PDF build failed)'
          : '') +
        '. Check inbox and spam for ' +
        resolved.to +
        '.' +
        (sendMeta.usedPort587 ? ' (port 587)' : ''),
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    // eslint-disable-next-line no-console
    console.warn('[go-live-audit] watch digest email failed:', msg);
    if (/Invalid login|535|EAUTH|authentication failed/i.test(msg)) {
      return { error: msg, reason: NOT_APP_PASSWORD_HINT };
    }
    return { error: msg };
  }
}

module.exports = {
  maybeSendScanEmail,
  maybeSendWatchDigestEmail,
  buildWatchDigestEntry,
  buildWatchDigestPlainText,
  buildWatchDigestHtml,
  buildWatchDigestSubject,
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
