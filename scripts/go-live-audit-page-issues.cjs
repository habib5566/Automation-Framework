'use strict';

/**
 * Best-effort page issues: downtime signals + console/runtime hints from HTML (and optional Playwright logs).
 */

function detectHtmlRuntimeIssues(body) {
  const html = String(body || '');
  const lower = html.toLowerCase();
  const issues = [];

  const patterns = [
    { re: /ChunkLoadError|Loading chunk \d+ failed/i, label: 'Chunk load failure (JS bundle)' },
    { re: /Hydration failed|Text content does not match/i, label: 'React hydration mismatch' },
    { re: /Uncaught\s+(?:TypeError|ReferenceError|Error)/i, label: 'Uncaught JavaScript error in page source' },
    { re: /Application error: a client-side exception/i, label: 'Next.js client-side exception' },
    { re: /__NEXT_DATA__[^]*?"err"\s*:/i, label: 'Next.js __NEXT_DATA__ contains error' },
    { re: /This site can(?:'|&#39;)t be reached|ERR_CONNECTION_REFUSED/i, label: 'Browser-style connection error text' },
    { re: /502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout/i, label: 'Gateway / server error page text' },
    { re: /console\.error\s*\(/i, label: 'console.error() call in inline script' },
  ];

  for (const p of patterns) {
    if (p.re.test(html)) {
      issues.push({ kind: 'html', severity: 'error', message: p.label });
    }
  }

  if (/console\.warn\s*\(/i.test(html)) {
    issues.push({ kind: 'html', severity: 'warn', message: 'console.warn() in page source' });
  }

  if (lower.includes('sentry') && /captureexception|capturemessage/i.test(html)) {
    issues.push({ kind: 'html', severity: 'info', message: 'Sentry error reporting detected in HTML' });
  }

  return issues;
}

function issuesFromAvailability(availability, statusCode) {
  const issues = [];
  const sc = Number(statusCode) || 0;
  const av = availability || {};

  if (sc >= 500) {
    issues.push({
      kind: 'http',
      severity: 'error',
      message: `Site returned HTTP ${sc} — likely down or broken (${av.headline || 'server error'})`,
    });
  } else if (sc >= 400) {
    issues.push({
      kind: 'http',
      severity: 'warn',
      message: `HTTP ${sc} — ${av.headline || 'request problem'}`,
    });
  }

  if (av.state && ['dns_failed', 'connection_refused', 'timeout', 'unreachable', 'connection_reset'].includes(av.state)) {
    issues.push({
      kind: 'availability',
      severity: 'error',
      message: av.headline || av.detail || 'Site unreachable',
    });
  }

  return issues;
}

function issuesFromPlaywrightConsole(logs) {
  const issues = [];
  if (!Array.isArray(logs)) return issues;
  for (const entry of logs.slice(0, 40)) {
    if (!entry || !entry.text) continue;
    const t = String(entry.type || '').toLowerCase();
    if (t === 'error' || t === 'pageerror') {
      issues.push({
        kind: 'console',
        severity: 'error',
        message: String(entry.text).slice(0, 500),
      });
    } else if (t === 'warning' || t === 'warn') {
      issues.push({
        kind: 'console',
        severity: 'warn',
        message: String(entry.text).slice(0, 400),
      });
    }
  }
  return issues;
}

function mergeIssues(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const it of list || []) {
      const key = (it.kind || '') + '|' + (it.severity || '') + '|' + (it.message || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}

function summarizeIssues(issues) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warn').length;
  return { errors, warns, total: issues.length };
}

module.exports = {
  detectHtmlRuntimeIssues,
  issuesFromAvailability,
  issuesFromPlaywrightConsole,
  mergeIssues,
  summarizeIssues,
};
