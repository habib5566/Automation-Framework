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

/** Site health from HTTP + material site/console signals (not raw noisy console). */
function computeSiteHealthPercent({ reachable, statusCode, availability, piSum, consoleSum }) {
  if (!reachable) return 0;
  const sc = Number(statusCode) || 0;
  const avState = availability && availability.state ? String(availability.state) : '';
  if (sc >= 500 || sc === 521 || avState === 'server_error') return 8;
  if (['dns_failed', 'connection_refused', 'timeout', 'unreachable', 'connection_reset'].includes(avState)) {
    return 0;
  }
  // Host responded — 404/403 is a URL/access issue, not “site down”.
  if (sc === 404 || avState === 'page_not_found') return 58;
  if (sc >= 400 && sc < 500) return 48;

  const consoleErrors =
    consoleSum && consoleSum.errors != null ? Number(consoleSum.errors) : 0;
  let h = 94;
  h -= Math.min(20, (piSum.errors || 0) * 5);
  h -= Math.min(10, (piSum.warns || 0) * 2);
  h -= Math.min(18, consoleErrors * 3);
  if (avState === 'up' && sc >= 200 && sc < 300 && (piSum.errors || 0) === 0 && consoleErrors === 0) {
    h = Math.max(h, 88);
  }
  return clampPct(h);
}

function computeChecklistPercent(counts) {
  const pass = counts.pass || 0;
  const fail = counts.fail || 0;
  const scored = pass + fail;
  if (!scored) return null;
  return clampPct((pass / scored) * 100);
}

/** Checklist rows where Fail = something the scanner actually detected on the live page. */
const DETECTED_FAIL_IDS = new Set(['I01', 'C01', 'U03', 'P03', 'U02']);

/**
 * Genuine site score from what the scan detected (HTTP + material issues + critical threats).
 * Does not mix in manual-review (pending) rows or soft checklist noise.
 */
function computeGenuinePerformancePercent({
  reachable,
  statusCode,
  availability,
  siteIssuesSummary,
  consoleDisplaySummary,
  security,
  autoChecks,
}) {
  if (!reachable) return 0;
  const sc = Number(statusCode) || 0;
  const avState = availability && availability.state ? String(availability.state) : '';

  if (sc >= 500 || sc === 521 || avState === 'server_error') return clampPct(6);
  if (['dns_failed', 'connection_refused', 'timeout', 'unreachable', 'connection_reset'].includes(avState)) {
    return 0;
  }
  if (sc === 404 || avState === 'page_not_found') return 54;
  if (sc >= 400 && sc < 500) return 46;

  const siteErr = Number((siteIssuesSummary && siteIssuesSummary.errors) || 0);
  const consoleErr = Number((consoleDisplaySummary && consoleDisplaySummary.errors) || 0);
  const critical = Number((security && security.criticalCount) || 0);

  let hardFails = 0;
  for (const ac of autoChecks || []) {
    if (!ac || ac.status !== 'fail') continue;
    if (DETECTED_FAIL_IDS.has(ac.id)) hardFails += 1;
  }

  let score = 97;
  score -= Math.min(14, siteErr * 7);
  score -= Math.min(12, consoleErr * 4);
  score -= Math.min(24, critical * 12);
  score -= Math.min(10, hardFails * 5);

  const liveOk =
    (avState === 'up' || (sc >= 200 && sc < 300)) &&
    siteErr === 0 &&
    consoleErr === 0 &&
    critical === 0;
  if (liveOk && hardFails === 0) score = Math.max(score, 92);
  else if (liveOk && hardFails <= 1) score = Math.max(score, 85);

  return clampPct(score);
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
  siteIssuesSummary,
  siteStack,
  requestedUrl,
  finalUrl,
  consoleDisplaySummary,
  security,
  autoChecks,
}) {
  const counts = (overallSummary && overallSummary.counts) || {
    pass: 0,
    fail: 0,
    pending: 0,
    notScored: 0,
  };
  const piSum =
    siteIssuesSummary ||
    pickNonConsoleIssues(pageIssues).summary ||
    { errors: 0, warns: 0, total: 0 };
  const consoleSum = consoleDisplaySummary || {
    errors: 0,
    warns: 0,
    total: 0,
  };
  const sc = Number(statusCode) || 0;

  const siteHealth = computeSiteHealthPercent({
    reachable,
    statusCode,
    availability,
    piSum,
    consoleSum,
  });
  const checklistPct = computeChecklistPercent(counts);

  const performancePercent = computeGenuinePerformancePercent({
    reachable,
    statusCode,
    availability,
    siteIssuesSummary: piSum,
    consoleDisplaySummary: consoleSum,
    security,
    autoChecks,
  });

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
      { key: 'performance', label: 'Live site score (detected)', value: performancePercent + '%' },
      { key: 'siteHealth', label: 'HTTP / runtime health', value: siteHealth + '%' },
      {
        key: 'checklistPct',
        label: 'Checklist pass rate (all rows)',
        value: checklistPct != null ? checklistPct + '%' : '—',
      },
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
  const av = result.availability || {};
  const osLevel = os.level || null;
  return {
    brandName: result.brandName || null,
    url: result.requestedUrl || result.finalUrl || null,
    consoleCapture: sm.consoleCapture || null,
    browserScanOk: !!sm.browserScanOk,
    pass: counts.pass || 0,
    fail: counts.fail || 0,
    pending: counts.pending || 0,
    headline: (os.headline || sec.headline || null),
    overallLevel: osLevel,
    availabilityState: av.state || null,
    httpStatus: result.statusCode != null ? result.statusCode : null,
    performancePercent:
      result.brandMatrix && result.brandMatrix.performancePercent != null
        ? result.brandMatrix.performancePercent
        : null,
    alert: !!(sec.shouldAlert || sec.alertLevel === 'critical'),
    siteUp: av.state === 'up' || (result.statusCode >= 200 && result.statusCode < 400),
  };
}

module.exports = {
  buildBrandMatrix,
  computeGenuinePerformancePercent,
  pickConsoleIssues,
  pickNonConsoleIssues,
  extractBrandScanSummary,
};
