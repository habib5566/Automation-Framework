'use strict';

/**
 * Unified vulnerability / risk list for UI + email (threats + outdated stack + site issues).
 */
function buildVulnerabilities({ security, siteStack, pageIssues, siteIssues, consoleIssues }) {
  const items = [];
  const seen = new Set();

  function add(row) {
    const key = (row.id || '') + '|' + (row.title || '');
    if (seen.has(key)) return;
    seen.add(key);
    items.push(row);
  }

  const sec = security || {};
  for (const t of sec.threats || []) {
    const sev = t.severity === 'critical' ? 'critical' : t.severity === 'warn' ? 'high' : 'medium';
    add({
      id: 'threat_' + (t.id || t.kind || 'unknown'),
      severity: sev,
      category: t.kind || 'threat',
      title: t.message || 'Security threat',
      detail: 'Detected in page HTML / headers',
      source: 'security-monitor',
    });
  }
  if (sec.baselineDrift && sec.baselineDrift.changed) {
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

  for (const it of (consoleIssues && consoleIssues.items) || []) {
    if (!it) continue;
    const sev = it.severity === 'error' ? 'high' : it.severity === 'warn' ? 'medium' : 'low';
    add({
      id: 'console_' + String(it.message || '').slice(0, 36),
      severity: sev,
      category: 'console',
      title: String(it.message || 'Console message').slice(0, 220),
      detail: 'Captured from live browser (Playwright) or HTML hints',
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
  if (summary.critical > 0) {
    headline = summary.critical + ' critical + ' + (summary.total - summary.critical) + ' other risk(s)';
  } else if (summary.high > 0) {
    headline = summary.high + ' high-risk finding(s)';
  } else if (summary.total > 0) {
    headline = summary.total + ' medium/low risk(s) — review recommended';
  }

  return { summary, items, headline };
}

module.exports = { buildVulnerabilities };
