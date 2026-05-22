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

/**
 * Brand performance matrix (% rate) from checklist + HTTP + page/console issues.
 */
function buildBrandMatrix({
  brandName,
  reachable,
  statusCode,
  availability,
  overallSummary,
  pageIssues,
  siteStack,
}) {
  const counts = (overallSummary && overallSummary.counts) || {
    pass: 0,
    fail: 0,
    pending: 0,
    notScored: 0,
  };
  const piSum = (pageIssues && pageIssues.summary) || { errors: 0, warns: 0, total: 0 };
  const consoleSum = pickConsoleIssues(pageIssues).summary;
  const sc = Number(statusCode) || 0;
  const avState = availability && availability.state ? String(availability.state) : '';

  const scored = (counts.pass || 0) + (counts.fail || 0);
  let performancePercent = 0;

  if (!reachable || sc >= 500 || avState === 'server_error' || ['dns_failed', 'connection_refused', 'timeout', 'unreachable'].includes(avState)) {
    performancePercent = 0;
  } else if (sc >= 400) {
    performancePercent = 15;
  } else if (scored > 0) {
    const passRate = (counts.pass / scored) * 100;
    performancePercent = Math.round(passRate);
    performancePercent -= (counts.fail || 0) * 10;
    performancePercent -= (piSum.errors || 0) * 12;
    performancePercent -= (piSum.warns || 0) * 4;
    performancePercent -= (consoleSum.errors || 0) * 8;
  } else if (sc >= 200 && sc < 400) {
    performancePercent = 75 - (piSum.errors || 0) * 15 - (consoleSum.errors || 0) * 10;
  } else {
    performancePercent = 40;
  }

  performancePercent = Math.min(100, Math.max(0, performancePercent));

  let grade = 'F';
  if (performancePercent >= 90) grade = 'A';
  else if (performancePercent >= 80) grade = 'B';
  else if (performancePercent >= 65) grade = 'C';
  else if (performancePercent >= 45) grade = 'D';

  const passPct = scored > 0 ? Math.round((counts.pass / scored) * 100) : null;

  const frameworks = (siteStack && siteStack.items ? siteStack.items : [])
    .filter((i) => ['framework', 'cms', 'runtime', 'frontend'].includes(i.category))
    .slice(0, 12)
    .map((i) => ({
      id: i.id,
      label: i.label,
      version: i.version || null,
      category: i.category,
    }));

  return {
    brandName: brandName || null,
    performancePercent,
    performanceGrade: grade,
    passRatePercent: passPct,
    matrix: [
      { key: 'brand', label: 'Brand', value: brandName || '—' },
      { key: 'performance', label: 'Performance rate', value: performancePercent + '%' },
      { key: 'grade', label: 'Grade', value: grade },
      {
        key: 'checklist',
        label: 'Checklist pass rate',
        value: passPct != null ? passPct + '% (' + counts.pass + '/' + scored + ')' : '—',
      },
      { key: 'fail', label: 'Checklist fail', value: String(counts.fail || 0) },
      { key: 'errors', label: 'Site / HTTP errors', value: String(piSum.errors || 0) },
      { key: 'console', label: 'Console errors', value: String(consoleSum.errors || 0) },
      { key: 'http', label: 'HTTP status', value: sc ? String(sc) : '—' },
    ],
    frameworks,
    counts,
    scannedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildBrandMatrix,
  pickConsoleIssues,
  pickNonConsoleIssues,
};
