/**
 * Static catalog: har planned test case (viewport × check + cross flows).
 * Playwright run se pehle/ke baad chala sakte ho — results CSV se alag hai.
 */
const fs = require('fs');
const path = require('path');

const { VIEWPORTS, CORE_CHECKS } = require('../data/payment-checks');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'reports');
const outPath = path.join(outDir, 'payment-test-cases-catalog.csv');

const esc = (s) => `"${String(s).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

const lines = [
  [
    'TC_ID',
    'Base_Check_ID',
    'Viewport_Label',
    'Width',
    'Height',
    'Scenario_Title',
    'Playwright_Spec',
    'Notes',
  ].join(','),
];

for (const vp of VIEWPORTS) {
  for (const c of CORE_CHECKS) {
    const tcId = `${c.id} [${vp.label}]`;
    lines.push(
      [
        esc(tcId),
        esc(c.id),
        esc(vp.label),
        vp.width,
        vp.height,
        esc(c.title),
        esc('tests/payment-deep.spec.js'),
        esc('Generated from data/payment-checks.js'),
      ].join(',')
    );
  }
}

const cross = [
  {
    id: 'PAY-X-01',
    title: 'Dashboard ↔ payment navigation round-trip',
    spec: 'tests/payment-cross.spec.js',
  },
  {
    id: 'PAY-X-02',
    title: 'Hard reload on payment preserves URL',
    spec: 'tests/payment-cross.spec.js',
  },
  {
    id: 'PAY-X-03',
    title: 'Payment page host remains designcentura.com',
    spec: 'tests/payment-cross.spec.js',
  },
  {
    id: 'PAY-X-04',
    title: 'Three sequential payment loads remain stable',
    spec: 'tests/payment-cross.spec.js',
  },
];

for (const x of cross) {
  lines.push(
    [
      esc(x.id),
      esc(x.id),
      esc('default-desktop'),
      1920,
      1080,
      esc(x.title),
      esc(x.spec),
      esc('Cross-route; project default Chrome viewport'),
    ].join(',')
  );
}

lines.push(
  [
    esc('AUTH-001'),
    esc('AUTH-001'),
    esc('setup'),
    esc(''),
    esc(''),
    esc('Login and save storage state for payment project'),
    esc('tests/auth.setup.js'),
    esc('Must pass before payment specs run'),
  ].join(',')
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
// eslint-disable-next-line no-console
console.log('Wrote', outPath, `(${lines.length - 1} data rows)`);
