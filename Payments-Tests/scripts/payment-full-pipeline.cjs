/**
 * Playwright chalao (pass/fail dono), phir catalog CSV, phir Word report.
 * Windows: npm fail ho to bhi `node scripts/payment-full-pipeline.cjs` use karo.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const node = process.execPath;
const pwRunner = path.join(__dirname, 'run-playwright-with-local-browsers.cjs');

function run(scriptRelative) {
  const script = path.join(__dirname, scriptRelative);
  const r = spawnSync(node, [script], { cwd: root, stdio: 'inherit', env: process.env });
  return r.status ?? 1;
}

const testExit = spawnSync(node, [pwRunner, 'test'], { cwd: root, stdio: 'inherit', env: process.env }).status ?? 1;

run('export-payment-test-matrix.cjs');
const wordExit = run('build-payment-word.cjs');

// eslint-disable-next-line no-console
console.log('\n--- Payments pipeline done ---');
// eslint-disable-next-line no-console
console.log('  Playwright HTML: reports/html-report  (npm run report:html)');
// eslint-disable-next-line no-console
console.log('  Run results CSV:  reports/payment-test-run.csv');
// eslint-disable-next-line no-console
console.log('  Test catalog CSV: reports/payment-test-cases-catalog.csv');
// eslint-disable-next-line no-console
console.log('  Word report:      reports/Payments-Module-QA-Report.docx');

process.exit(testExit !== 0 ? testExit : wordExit);
