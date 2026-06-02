'use strict';

const { summarizeIssues } = require('./go-live-audit-page-issues.cjs');

function pickConsoleIssues(pageIssues) {
  const items = (pageIssues && pageIssues.items ? pageIssues.items : []).filter((i) => i.kind === 'console');
  return { items, summary: summarizeIssues(items) };
}

function pickNonConsoleIssues(pageIssues) {
  const items = (pageIssues && pageIssues.items ? pageIssues.items : []).filter((i) => i.kind !== 'console');
  return { items, summary: summarizeIssues(items) };
}

function clampPct(n) {
  return Math.min(100, Math.max(0, Math.round(Number(n) || 0)));
}

/** Site health from HTTP + console + availability (not checklist alone). */
function computeSiteHealthPercent({ reachable, statusCode, availability, piSum, consoleSum }) {
  if (!reachable) return 0;
  const sc = Number(statusCode) || 0;
  const avState = availability && availability.state ? String(availability.state) : '';
  if (sc >= 500 || avState === 'server_error') return 8;
  if (['dns_failed', 'connection_refused', 'timeout', 'unreachable'].includes(avState)) return 0;
  if (sc >= 400) return 22;

  let h = 92;
  h -= Math.min(28, (piSum.errors || 0) * 6);
  h -= Math.min(12, (piSum.warns || 0) * 2);
  h -= Math.min(22, (consoleSum.errors || 0) * 4);
  return clampPct(h);
}

function computeChecklistPercent(counts) {
  const pass = counts.pass || 0;
  const fail = counts.fail || 0;
  const scored = pass + fail;
  if (!scored) return null;
  const raw = (pass / scored) * 100;
  const penalized = raw - Math.min(18, fail * 2);
  return clampPct(penalized);
}

/**
 * Brand performance matrix — blends live site health + checklist (avoids false 0% when checklist rows fail).
 */
function buildBrandMatrix({
  brandName,
  reachable,
  statusCode,
  availability,
  overallSummary,
  pageIssues,
  siteStack,
  requestedUrl,
  finalUrl,
  consoleDisplaySummary,
}) {
  const counts = (overallSummary && overallSummary.counts) || {
    pass: 0,
    fail: 0,
    pending: 0,
    notScored: 0,
  };
  const piSum = (pageIssues && pageIssues.summary) || { errors: 0, warns: 0, total: 0 };
  const consoleSum =
    consoleDisplaySummary ||
    pickConsoleIssues(pageIssues).summary;
  const sc = Number(statusCode) || 0;

  const siteHealth = computeSiteHealthPercent({
    reachable,
    statusCode,
    availability,
    piSum,
    consoleSum,
  });
  const checklistPct = computeChecklistPercent(counts);

  let performancePercent;
  const pending = counts.pending || 0;
  if (checklistPct != null) {
    const autoScored = (counts.pass || 0) + (counts.fail || 0);
    const failHeavy = autoScored > 0 && (counts.fail || 0) / autoScored > 0.35;
    if (pending > autoScored && !failHeavy) {
      performancePercent = clampPct(siteHealth * 0.75 + checklistPct * 0.25);
    } else {
      performancePercent = clampPct(siteHealth * 0.6 + checklistPct * 0.4);
    }
  } else {
    performancePercent = siteHealth;
  }

  let grade = 'F';
  if (performancePercent >= 88) grade = 'A';
  else if (performancePercent >= 75) grade = 'B';
  else if (performancePercent >= 58) grade = 'C';
  else if (performancePercent >= 40) grade = 'D';

  const pass = counts.pass || 0;
  const fail = counts.fail || 0;
  const scored = pass + fail;
  const passPct = scored > 0 ? Math.round((pass / scored) * 100) : null;

  const frameworks = (siteStack && siteStack.items ? siteStack.items : [])
    .filter((i) => ['framework', 'cms', 'runtime', 'frontend'].includes(i.category))
    .slice(0, 12)
    .map((i) => ({
      id: i.id,
      label: i.label,
      version: i.version || null,
      category: i.category,
    }));

  let host = '';
  try {
    host = new URL(finalUrl || requestedUrl || 'http://x').hostname;
  } catch {
    host = '';
  }

  return {
    brandName: brandName || null,
    scannedUrl: requestedUrl || null,
    finalUrl: finalUrl || null,
    host,
    performancePercent,
    performanceGrade: grade,
    siteHealthPercent: siteHealth,
    checklistPercent: checklistPct,
    passRatePercent: passPct,
    matrix: [
      { key: 'url', label: 'Scanned URL', value: requestedUrl || '—' },
      { key: 'final', label: 'Final URL', value: finalUrl || requestedUrl || '—' },
      { key: 'brand', label: 'Brand', value: brandName || '—' },
      { key: 'performance', label: 'Performance rate', value: performancePercent + '%' },
      { key: 'siteHealth', label: 'Site health score', value: siteHealth + '%' },
      { key: 'grade', label: 'Grade', value: grade },
      {
        key: 'checklist',
        label: 'Checklist pass rate',
        value: passPct != null ? passPct + '% (' + pass + '/' + scored + ')' : '— (run scan with checklist)',
      },
      { key: 'fail', label: 'Checklist fail', value: String(fail) },
      { key: 'errors', label: 'Site / HTTP errors', value: String(piSum.errors || 0) },
      { key: 'console', label: 'Console errors', value: String(consoleSum.errors || 0) },
      { key: 'http', label: 'HTTP status', value: sc ? String(sc) : '—' },
    ],
    frameworks,
    counts,
    scannedAt: new Date().toISOString(),
  };
}

/** Compact row for multi-brand watch summary (UI + API). */
function extractBrandScanSummary(result) {
  if (!result || typeof result !== 'object') return null;
  const os = result.overallSummary || {};
  const counts = os.counts || {};
  const sm = result.scanMeta || {};
  const sec = result.security || {};
  return {
    brandName: result.brandName || null,
    url: result.requestedUrl || result.finalUrl || null,
    consoleCapture: sm.consoleCapture || null,
    browserScanOk: !!sm.browserScanOk,
    pass: counts.pass || 0,
    fail: counts.fail || 0,
    pending: counts.pending || 0,
    headline: sec.headline || null,
    alert: !!(sec.shouldAlert || sec.alertLevel === 'critical'),
  };
}

module.exports = {
  buildBrandMatrix,
  pickConsoleIssues,
  pickNonConsoleIssues,
  extractBrandScanSummary,
};
