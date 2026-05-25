'use strict';

/**
 * Unified vulnerability / risk list for UI + email (threats + outdated stack + site issues).
 */
function buildVulnerabilities({ security, siteStack, pageIssues, siteIssues, consoleIssues, scanMeta }) {
  const items = [];
  const seen = new Set();
  const browserFailed =
    scanMeta && String(scanMeta.consoleCapture || '').includes('failed');

  function add(row) {
    const key = (row.id || '') + '|' + (row.title || '');
    if (seen.has(key)) return;
    seen.add(key);
    items.push(row);
  }

  const sec = security || {};
  let baselineAdded = false;
  for (const t of sec.threats || []) {
    const sev = t.severity === 'critical' ? 'critical' : t.severity === 'warn' ? 'high' : 'medium';
    if (t.kind === 'integrity' && /fingerprint|changed since/i.test(String(t.message || ''))) {
      if (baselineAdded) continue;
      baselineAdded = true;
    }
    add({
      id: 'threat_' + (t.id || t.kind || 'unknown'),
      severity: sev,
      category: t.kind || 'threat',
      title: t.message || 'Security threat',
      detail: 'Detected in page HTML / headers',
      source: 'security-monitor',
    });
  }
  if (sec.baselineDrift && sec.baselineDrift.changed && !baselineAdded) {
    add({
      id: 'baseline_drift',
      severity: 'high',
      category: 'integrity',
      title: 'Page changed vs last clean scan',
      detail:
        'Was: ' + (sec.baselineDrift.previousTitle || '—') + ' → Now: ' + (sec.baselineDrift.currentTitle || '—'),
      source: 'brand-watch',
    });
  }

  for (const it of (siteStack && siteStack.items) || []) {
    if (!it || (it.alert !== 'bad' && it.alert !== 'warn')) continue;
    add({
      id: 'stack_' + (it.id || it.label),
      severity: it.alert === 'bad' ? 'high' : 'medium',
      category: it.category || 'stack',
      title: (it.label || 'Component') + (it.version ? ' ' + it.version : ''),
      detail: it.detail || 'Version or configuration risk',
      source: 'technology-stack',
    });
  }

  if (browserFailed) {
    add({
      id: 'browser_capture_failed',
      severity: 'high',
      category: 'infrastructure',
      title: 'Real browser scan unavailable on Vercel (Chromium)',
      detail: (scanMeta.consoleCaptureDetail || 'Chromium could not launch').slice(0, 220),
      source: 'scan-meta',
    });
  }

  for (const it of (consoleIssues && consoleIssues.items) || []) {
    if (!it) continue;
    const msg = String(it.message || '');
    if (browserFailed && /Browser console capture failed on server/i.test(msg)) continue;
    let sev = it.severity === 'error' ? 'high' : it.severity === 'warn' ? 'medium' : 'low';
    if (/Script returned HTTP [45]\d|Failed to load resource|net::ERR_/i.test(msg)) {
      sev = 'high';
    }
    add({
      id: 'console_' + msg.slice(0, 36),
      severity: sev,
      category: 'console',
      title: msg.slice(0, 220),
      detail: browserFailed
        ? 'Detected via HTTP/script checks (browser did not run on server)'
        : 'Captured from live browser (Playwright)',
      source: 'browser-console',
    });
  }

  const issueSrc = siteIssues && siteIssues.items && siteIssues.items.length ? siteIssues : pageIssues;
  for (const it of (issueSrc && issueSrc.items) || []) {
    if (!it || it.kind === 'console') continue;
    const sev = it.severity === 'error' ? 'medium' : it.severity === 'warn' ? 'low' : 'info';
    if (sev === 'info') continue;
    add({
      id: 'issue_' + (it.kind || 'site') + '_' + String(it.message || '').slice(0, 40),
      severity: sev,
      category: it.kind || 'site',
      title: String(it.message || 'Site issue').slice(0, 220),
      detail: 'From HTTP / availability scan',
      source: 'page-scan',
    });
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  items.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  const summary = {
    critical: items.filter((i) => i.severity === 'critical').length,
    high: items.filter((i) => i.severity === 'high').length,
    medium: items.filter((i) => i.severity === 'medium').length,
    low: items.filter((i) => i.severity === 'low').length,
    total: items.length,
  };

  let headline = 'No vulnerabilities flagged in this pass';
  if (summary.total > 0) {
    headline =
      summary.total +
      ' finding(s) — Critical: ' +
      summary.critical +
      ', High: ' +
      summary.high +
      ', Medium: ' +
      summary.medium +
      (summary.low ? ', Low: ' + summary.low : '');
  }

  return { summary, items, headline };
}

module.exports = { buildVulnerabilities };
