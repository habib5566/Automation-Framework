'use strict';

/**
 * Best-effort page issues: downtime signals + console/runtime hints from HTML (and optional Playwright logs).
 */

function detectHtmlRuntimeIssues(body) {
  const html = String(body || '');
  const lower = html.toLowerCase();
  const issues = [];

  const shortPage = html.length < 12_000;
  const patterns = [
    { re: /ChunkLoadError|Loading chunk \d+ failed/i, label: 'Chunk load failure (JS bundle)' },
    { re: /Hydration failed|Text content does not match/i, label: 'React hydration mismatch' },
    {
      re: /Uncaught\s+(?:TypeError|ReferenceError):/i,
      label: 'Uncaught JavaScript error in page source',
    },
    { re: /Application error: a client-side exception/i, label: 'Next.js client-side exception' },
    { re: /__NEXT_DATA__[^]*?"err"\s*:/i, label: 'Next.js __NEXT_DATA__ contains error' },
  ];
  if (shortPage) {
    patterns.push(
      { re: /This site can(?:'|&#39;)t be reached|ERR_CONNECTION_REFUSED/i, label: 'Browser-style connection error text' },
      { re: /<title[^>]*>[^<]*502 Bad Gateway/i, label: '502 error page (title)' },
      { re: /<h1[^>]*>[^<]*502 Bad Gateway/i, label: '502 error page (heading)' }
    );
  }

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

/** When Playwright fails on Vercel, surface likely third-party script risks from HTML (partial parity with local console). */
function issuesFromHtmlScriptHints(body) {
  const html = String(body || '');
  const issues = [];
  const seen = new Set();
  const srcRe = /\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = srcRe.exec(html)) !== null && issues.length < 8) {
    const u = m[1];
    if (!/google\.com\/ccm|googletagmanager|google-analytics|doubleclick|gtag\/js/i.test(u)) continue;
    const key = u.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      kind: 'console',
      severity: 'warn',
      message:
        'Third-party script in HTML (often shows console errors in a real browser): ' + u.slice(0, 160),
    });
  }
  return issues;
}

function issuesFromAvailability(availability, statusCode) {
  const issues = [];
  const sc = Number(statusCode) || 0;
  const av = availability || {};

  if (sc >= 500 || sc === 521) {
    issues.push({
      kind: 'http',
      severity: 'error',
      message: `Site returned HTTP ${sc} — likely down or broken (${av.headline || 'server error'})`,
    });
  } else if (sc === 404) {
    issues.push({
      kind: 'http',
      severity: 'warn',
      message: `HTTP 404 — host is up but this path was not found (${av.detail || ''})`.trim(),
    });
  } else if (sc >= 400) {
    issues.push({
      kind: 'http',
      severity: 'warn',
      message: `HTTP ${sc} — ${av.headline || 'request problem'} (server responded; check URL or access)`,
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

/** Benign third-party / ad-blocker / infra noise — do not tank site scores. */
function isNoisyConsoleMessage(msg) {
  const m = String(msg || '');
  if (/Browser console capture failed on server/i.test(m)) return true;
  if (/Third-party script in HTML/i.test(m)) return true;
  if (/ERR_BLOCKED_BY_CLIENT|net::ERR_ABORTED|Non-Error promise rejection/i.test(m)) return true;
  if (/favicon\.ico|google-analytics|googletagmanager|gtag\/js|doubleclick|facebook\.net|hotjar|clarity\.ms|adservice|analytics\.js|chrome-extension/i.test(m)) {
    return true;
  }
  if (/ResizeObserver loop|Non-passive event listener|preload.*not used|cookie.*will be soon blocked/i.test(m)) {
    return true;
  }
  if (/Failed to load resource.*(analytics|pixel|tracking|ads)/i.test(m)) return true;
  return false;
}

function issuesFromPlaywrightConsole(logs) {
  const issues = [];
  if (!Array.isArray(logs)) return issues;
  for (const entry of logs.slice(0, 40)) {
    if (!entry || !entry.text) continue;
    if (isNoisyConsoleMessage(entry.text)) continue;
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

/** Count only issues that should affect checklist pass/fail and health scores. */
function summarizeMaterialIssues(issues, scanMeta) {
  const cap = scanMeta && scanMeta.consoleCapture ? String(scanMeta.consoleCapture) : '';
  const htmlOnly = /html-only|vercel-empty|vercel-failed|vercel-http/i.test(cap);
  const filtered = (issues || []).filter((it) => {
    if (isNoisyConsoleMessage(it.message)) return false;
    if (htmlOnly && it.kind === 'console' && it.severity === 'warn') return false;
    return true;
  });
  return { ...summarizeIssues(filtered), filtered };
}

/** UI counts — script/HTTP failures count as errors; infra-only browser-fail line separate. */
function computeConsoleDisplaySummary(items, scanMeta) {
  const list = Array.isArray(items) ? items : [];
  let errors = 0;
  let warns = 0;
  let infra = 0;
  for (const it of list) {
    const msg = String(it.message || '');
    if (/Browser console capture failed on server/i.test(msg)) {
      infra++;
      continue;
    }
    if (isNoisyConsoleMessage(msg)) continue;
    if (
      it.severity === 'error' ||
      (/Script returned HTTP [45]\d|Failed to load resource|net::ERR_/i.test(msg) &&
        !/ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/i.test(msg))
    ) {
      errors++;
    } else if (it.severity === 'warn') {
      warns++;
    }
  }
  const cap = scanMeta && scanMeta.consoleCapture ? String(scanMeta.consoleCapture) : '';
  const browserFailed = cap.includes('failed');
  return {
    errors,
    warns,
    infra,
    total: list.length,
    browserFailed,
    siteIssues: errors + warns,
  };
}

module.exports = {
  detectHtmlRuntimeIssues,
  issuesFromHtmlScriptHints,
  issuesFromAvailability,
  issuesFromPlaywrightConsole,
  isNoisyConsoleMessage,
  mergeIssues,
  summarizeIssues,
  summarizeMaterialIssues,
  computeConsoleDisplaySummary,
};
