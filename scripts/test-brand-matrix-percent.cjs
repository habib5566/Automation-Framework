'use strict';

const {
  buildBrandMatrix,
  computeGenuinePerformancePercent,
} = require('./go-live-audit-brand-matrix.cjs');

function assertEq(label, got, want) {
  if (got !== want) {
    console.error('FAIL', label, 'got', got, 'want', want);
    return false;
  }
  console.log('OK  ', label, '=', got);
  return true;
}

function matrixScore(input) {
  const bm = buildBrandMatrix(input);
  const direct = computeGenuinePerformancePercent(input);
  return { bm: bm.performancePercent, direct, grade: bm.performanceGrade, siteHealth: bm.siteHealthPercent, checklist: bm.checklistPercent };
}

let ok = true;

// Unreachable site = 0%
let r = matrixScore({ reachable: false, statusCode: 0, availability: { state: 'unreachable' }, overallSummary: { counts: { pass: 0, fail: 0, pending: 30 } }, autoChecks: [], siteIssuesSummary: { errors: 0, warns: 0 }, consoleDisplaySummary: { errors: 0, warns: 0 } });
ok = assertEq('unreachable', r.bm, 0) && assertEq('unreachable direct match', r.direct, r.bm) && ok;

// Healthy site, many pending (manual) — score should stay high
r = matrixScore({
  reachable: true,
  statusCode: 200,
  availability: { state: 'up' },
  overallSummary: { counts: { pass: 12, fail: 1, pending: 25 }, level: 'good' },
  autoChecks: Array.from({ length: 38 }, (_, i) => ({ id: 'X' + i, status: i < 12 ? 'pass' : i === 12 ? 'fail' : 'pending' })),
  siteIssuesSummary: { errors: 0, warns: 0 },
  consoleDisplaySummary: { errors: 0, warns: 0 },
  security: { criticalCount: 0, warnCount: 0 },
});
ok = assertEq('healthy pending not punishing', r.bm >= 75, true) && ok;
ok = assertEq('build vs compute', r.bm, r.direct) && ok;
console.log('     breakdown siteHealth', r.siteHealth, 'checklist', r.checklist, 'grade', r.grade);

// 500 error — low score
r = matrixScore({
  reachable: true,
  statusCode: 503,
  availability: { state: 'server_error' },
  overallSummary: { counts: { pass: 5, fail: 2, pending: 20 }, level: 'bad' },
  autoChecks: [],
  siteIssuesSummary: { errors: 2, warns: 0 },
  consoleDisplaySummary: { errors: 0, warns: 0 },
  security: { criticalCount: 1, warnCount: 2 },
});
ok = assertEq('server error low', r.bm <= 15, true) && ok;

// Checklist only pass+fail in rate: 2 pass 2 fail = 50%
const bm = buildBrandMatrix({
  reachable: true,
  statusCode: 200,
  availability: { state: 'up' },
  overallSummary: { counts: { pass: 2, fail: 2, pending: 30 } },
  autoChecks: [],
  siteIssuesSummary: { errors: 0, warns: 0 },
  consoleDisplaySummary: { errors: 0, warns: 0 },
  security: { criticalCount: 0, warnCount: 0 },
});
ok = assertEq('checklist pass rate', bm.passRatePercent, 50) && ok;
ok = assertEq('checklist percent', bm.checklistPercent, 50) && ok;

console.log(ok ? '\nAll performance matrix checks passed.' : '\nSome checks FAILED.');
process.exit(ok ? 0 : 1);
