'use strict';

const crypto = require('crypto');

/** @type {Array<{ id: string, severity: 'critical'|'warn'|'info', re: RegExp, message: string, kind?: string }>} */
const RULES = [
  { id: 'crypto_miner', severity: 'critical', kind: 'malware', re: /coinhive|cryptonight|crypto-loot|coin-hive|minero\.|webmine|deepMiner/i, message: 'Possible cryptocurrency miner script' },
  { id: 'obfuscated_js', severity: 'critical', kind: 'malware', re: /eval\s*\(\s*(?:atob|unescape|decodeURIComponent)\s*\(/i, message: 'Heavily obfuscated JavaScript (eval + decode)' },
  { id: 'php_shell', severity: 'critical', kind: 'intrusion', re: /c99shell|r57shell|FilesMan|b374k|wso\s*shell|php\s*shell|passthru\s*\(\s*\$_(?:GET|POST)/i, message: 'Possible PHP web shell signature in page' },
  { id: 'defacement', severity: 'critical', kind: 'defacement', re: /hacked\s+by|defaced\s+by|owned\s+by|pwned\s+by|cyber\s*attack/i, message: 'Defacement / hack message in HTML' },
  { id: 'seo_spam', severity: 'warn', kind: 'spam', re: /viagra|cialis|casino\s*online|payday\s*loan|replica\s*watch/i, message: 'SEO spam / pharma keywords (often injection)' },
  { id: 'hidden_iframe', severity: 'warn', kind: 'injection', re: /<iframe[^>]+(?:width|height)\s*=\s*["']?[01]["']?/i, message: 'Hidden iframe (possible clickjacking or injection)' },
  { id: 'suspicious_redirect', severity: 'warn', kind: 'redirect', re: /<meta[^>]+http-equiv\s*=\s*["']refresh["'][^>]+url\s*=\s*https?:\/\//i, message: 'Meta refresh redirect detected' },
  { id: 'sql_error', severity: 'warn', kind: 'exposure', re: /SQL syntax.*MySQL|ORA-\d{5}|PostgreSQL.*ERROR|sqlite3\.OperationalError/i, message: 'Database error exposed in page (possible SQLi probe)' },
  { id: 'git_exposed', severity: 'critical', kind: 'exposure', re: /\[core\]\s*repositoryformatversion|ref:\s*refs\/heads\/main/i, message: 'Possible .git repository content exposed in HTML' },
  { id: 'env_leak', severity: 'critical', kind: 'exposure', re: /APP_KEY=base64:|DB_PASSWORD=|AWS_SECRET_ACCESS_KEY=/i, message: 'Possible .env / secrets leaked in response' },
  { id: 'base64_blob', severity: 'warn', kind: 'malware', re: /[A-Za-z0-9+/]{500,}={0,2}/, message: 'Very large base64 blob in HTML (check for injected payload)' },
  { id: 'external_password_form', severity: 'warn', kind: 'phishing', re: /<form[^>]+action\s*=\s*["']https?:\/\/(?!localhost)[^"']+["'][^>]*(?:password|login)/i, message: 'Login form posts to external domain' },
];

function fingerprintPage(html, finalUrl) {
  const body = String(html || '').slice(0, 120_000);
  let host = '';
  try {
    host = new URL(finalUrl || 'http://x').hostname;
  } catch {
    host = '';
  }
  const title = (body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const scriptSrcs = (body.match(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi) || []).length;
  const iframeCount = (body.match(/<iframe\b/gi) || []).length;
  const formCount = (body.match(/<form\b/gi) || []).length;
  const sig = [host, title.trim().slice(0, 120), scriptSrcs, iframeCount, formCount, body.length].join('|');
  const hash = crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
  return { hash, title: title.trim().slice(0, 200), scriptSrcs, iframeCount, formCount };
}

/**
 * @param {object} opts
 * @param {string} opts.html
 * @param {Record<string,string>} [opts.headers]
 * @param {string} [opts.finalUrl]
 * @param {object} [opts.pageIssues]
 * @param {object} [opts.consoleIssues]
 * @param {object} [opts.baseline] prior fingerprint from brand watch
 */
function detectSecurityThreats(opts) {
  const html = String((opts && opts.html) || '');
  const lower = html.toLowerCase();
  const headers = opts.headers || {};
  const threats = [];
  const seen = new Set();

  function add(t) {
    const key = t.id + '|' + t.message;
    if (seen.has(key)) return;
    seen.add(key);
    threats.push(t);
  }

  for (const rule of RULES) {
    if (rule.re.test(html)) {
      add({
        id: rule.id,
        kind: rule.kind || 'threat',
        severity: rule.severity,
        message: rule.message,
      });
    }
  }

  const xPowered = String(headers['x-powered-by'] || headers['X-Powered-By'] || '');
  if (/sqlmap|nikto|masscan|ZmEu/i.test(xPowered)) {
    add({ id: 'scanner_header', kind: 'probe', severity: 'warn', message: 'Suspicious X-Powered-By scanner fingerprint' });
  }

  const pi = opts.pageIssues;
  if (pi && Array.isArray(pi.items)) {
    for (const it of pi.items) {
      if (it.kind === 'availability' || (it.severity === 'error' && it.kind === 'http')) {
        add({
          id: 'site_down',
          kind: 'availability',
          severity: 'critical',
          message: it.message || 'Site unreachable or HTTP error',
        });
      }
    }
  }

  const ci = opts.consoleIssues;
  if (ci && Array.isArray(ci.items)) {
    for (const it of ci.items.slice(0, 15)) {
      if (it.severity === 'error') {
        add({
          id: 'console_error',
          kind: 'console',
          severity: 'warn',
          message: 'Console: ' + String(it.message || '').slice(0, 200),
        });
      }
    }
  }

  const fp = fingerprintPage(html, opts.finalUrl);
  let baselineDrift = null;
  const baseline = opts.baseline;
  if (baseline && baseline.hash && baseline.hash !== fp.hash) {
    baselineDrift = {
      changed: true,
      previousTitle: baseline.title || '—',
      currentTitle: fp.title || '—',
      message: 'Page fingerprint changed since last clean scan (possible defacement or major deploy)',
    };
    add({
      id: 'baseline_drift',
      kind: 'integrity',
      severity: 'warn',
      message: baselineDrift.message,
    });
  }

  const criticalCount = threats.filter((t) => t.severity === 'critical').length;
  const warnCount = threats.filter((t) => t.severity === 'warn').length;
  let alertLevel = 'ok';
  if (criticalCount > 0) alertLevel = 'critical';
  else if (warnCount > 0) alertLevel = 'warn';

  return {
    alertLevel,
    criticalCount,
    warnCount,
    total: threats.length,
    threats,
    fingerprint: fp,
    baselineDrift,
    shouldAlert: criticalCount > 0 || (warnCount >= 2 && baselineDrift && baselineDrift.changed),
    headline:
      criticalCount > 0
        ? criticalCount + ' critical threat(s) detected'
        : warnCount > 0
          ? warnCount + ' security warning(s)'
          : 'No known threat signatures',
  };
}

module.exports = { detectSecurityThreats, fingerprintPage, RULES };
