/**
 * Narrative CRM Quality & Risk Review (.docx) — includes per-URL CRM guidance + run signals.
 * Run after: npx playwright test
 */
const fs = require('fs');
const path = require('path');
const { ADMIN_ROUTES } = require('../utils/routes.js');
const { CRM_MODULE_REVIEW } = require('../utils/crm-module-review.js');

function parseCsv(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const cells = [];
    let cur = '';
    let inQ = false;
    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j];
      if (ch === '"') {
        if (inQ && line[j + 1] === '"') {
          cur += '"';
          j += 1;
        } else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = (cells[idx] || '').replace(/^"|"$/g, '').replace(/""/g, '"');
    });
    rows.push(obj);
  }
  return rows;
}

function tcIdForModuleIndex(i) {
  return `TC-ADM-${String(i + 1).padStart(3, '0')}`;
}

async function main() {
  const {
    Document,
    Packer,
    Paragraph,
    Table,
    TableRow,
    TableCell,
    TextRun,
    HeadingLevel,
    WidthType,
    BorderStyle,
  } = await import('docx');

  const p = (text) =>
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text })],
    });

  const h1 = (text) =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } });

  const h2 = (text) =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 100 } });

  const root = path.join(__dirname, '..');
  const jsonPath = path.join(root, 'reports', 'designcentura-test-run.json');
  const csvPath = path.join(root, 'reports', 'designcentura-test-run.csv');
  const summaryPath = path.join(root, 'reports', 'summary.json');
  const outDocx = path.join(root, 'reports', 'Designcentura-CRM-QA-Report.docx');

  if (!fs.existsSync(jsonPath) && !fs.existsSync(csvPath)) {
    // eslint-disable-next-line no-console
    console.error('Missing reports/designcentura-test-run.json — run playwright test first.');
    process.exit(1);
  }

  /** @type {{ tcId: string, title: string, status: string, error: string, actual: string }[]} */
  let rows = [];
  if (fs.existsSync(jsonPath)) {
    rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } else {
    const csvRows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    rows = csvRows.map((r) => ({
      tcId: r.TC_ID,
      title: r.Test_Title,
      status: r.Status,
      error: r.Error_Summary,
      actual: r.Actual_Result,
    }));
  }

  const summary = fs.existsSync(summaryPath)
    ? JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
    : { total: rows.length, passed: rows.filter((r) => r.status === 'passed').length, failed: rows.filter((r) => r.status === 'failed').length };

  const total = summary.total ?? rows.length;
  const passed = summary.passed ?? rows.filter((r) => r.status === 'passed').length;
  const failed = summary.failed ?? rows.filter((r) => r.status === 'failed').length;
  const failedRows = rows.filter((r) => r.status === 'failed');

  const tcAdmRows = rows.filter((r) => /^TC-ADM-/.test(r.tcId));
  const unitUiRows = rows.filter((r) => /^UNIT-UI-/.test(r.tcId));
  const stressRows = rows.filter((r) => /^STRESS-/.test(r.tcId));

  const moduleList = ADMIN_ROUTES.map((r) => `${r.name} (${r.path})`).join('; ');
  const runDate = new Date().toISOString();

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1 },
      bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 },
      right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
      insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    },
    rows: [
      ['Metric', 'Value'],
      ['Automation run (UTC)', runDate],
      ['Target system', 'https://designcentura.com — CRM admin (/crm-pay/admin/)'],
      ['Playwright checks in this export', String(total)],
      ['— Regression (TC-ADM-*)', String(tcAdmRows.length)],
      ['— UI unit (UNIT-UI-*)', String(unitUiRows.length)],
      ['— Stress (STRESS-*)', String(stressRows.length)],
      ['Code unit tests (Node, lib/)', 'Run separately: npm run test:unit — not included in Playwright count'],
      ['Passed', String(passed)],
      ['Failed', String(failed)],
      ['Overall signal', failed === 0 ? 'No blocking failures in this run.' : 'Failures need investigation before release.'],
    ].map((cells, idx) =>
      new TableRow({
        children: cells.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: cell, bold: idx === 0 })],
                }),
              ],
            })
        ),
      })
    ),
  });

  /** @type {import('docx').Paragraph[]} */
  const perModuleBlocks = [
    h1('5. Per-module CRM review (your admin links)'),
    p(
      'This section maps each URL you specified to its business role, typical failure patterns in similar CRMs, and concrete improvement ideas. It is not a live penetration test or data audit. Under each link, this run’s outcomes are split: regression route check (TC-ADM), UI unit check (UNIT-UI), where present in the export.'
    ),
    ...CRM_MODULE_REVIEW.flatMap((m, i) => {
      const regId = tcIdForModuleIndex(i);
      const unitId = `UNIT-UI-${String(i + 1).padStart(3, '0')}`;
      const regHit = rows.find((r) => r.tcId === regId);
      const unitHit = rows.find((r) => r.tcId === unitId);
      const regLine = regHit
        ? `Regression route check (${regId}): ${regHit.status}.${regHit.status === 'failed' && regHit.error ? ` Detail: ${regHit.error.slice(0, 400)}` : ''}`
        : `Regression (${regId}): no row in this run export.`;
      const unitLine = unitHit
        ? `UI unit check (${unitId}): ${unitHit.status}.${unitHit.status === 'failed' && unitHit.error ? ` Detail: ${unitHit.error.slice(0, 400)}` : ''}`
        : `UI unit (${unitId}): not present in export (re-run full Playwright suite if missing).`;
      return [
        h2(m.name),
        p(`URL: ${m.fullUrl}`),
        p(`What this area is for: ${m.purpose}`),
        p(`Typical issues to watch for: ${m.typicalIssues}`),
        p(`What you can improve: ${m.improvements}`),
        p(regLine),
        p(unitLine),
      ];
    }),
  ];

  /** @type {import('docx').Paragraph[]} */
  const children = [
    new Paragraph({
      text: 'Design Centura CRM — Quality & Risk Review (Regression, UI Unit, Stress & Module Lens)',
      heading: HeadingLevel.TITLE,
    }),
    new Paragraph({
      children: [new TextRun({ text: `Document generated: ${runDate} (UTC)`, italics: true })],
    }),
    p(
      'This document summarises four layers: (1) Playwright regression checks (TC-ADM) on each admin URL, (2) Playwright UI unit checks (UNIT-UI) for shell/brand/nav consistency per route, (3) Playwright stress checks (STRESS) including sequential cycles, parallel tabs, and burst reloads, (4) optional Node code unit tests (`npm run test:unit` on lib/) which are not part of the Playwright export count. Section 5 adds a CRM lens per URL (risks and improvements).'
    ),

    h1('1. Executive summary'),
    p(
      failed === 0
        ? `The latest Playwright export contains ${total} checks (${tcAdmRows.length} regression, ${unitUiRows.length} UI unit, ${stressRows.length} stress) with ${passed} passed and zero failed. Separately, run \`npm run test:unit\` for Node-level unit tests on shared helpers in lib/.`
        : `The latest run reported ${failed} failing check(s) out of ${total} in the Playwright export. See Section 11; use HTML report and traces. Re-run \`npm run test:unit\` if you include code units in your sign-off.`
    ),
    p(
      'Section 5 is the product-specific review for your eight links (business risks + per-link automation outcomes). Sections 6–8 discuss cross-cutting CRM risks, limits of this pack, and operational recommendations.'
    ),

    h1('2. Scope under review'),
    p('Automation exercised the authenticated admin surface across these modules and paths:'),
    p(moduleList),
    p(
      'Coverage types in this programme: regression (URL + HTTP + text volume), UI unit (brand + dashboard nav visibility per route), stress (sequential full cycles, concurrent routes, burst reload, parallel fan-out), plus Node unit tests in lib/ when you execute npm run test:unit.'
    ),

    h1('3. What the automation validated (by layer)'),
    h2('3.1 Authentication and session'),
    p(
      'Setup performed a real login at the admin login URL and saved storage state for subsequent tests. If credentials, MFA, captcha, or UI selectors change, setup fails first—treat that as an early gate before interpreting route results.'
    ),
    h2('3.2 Regression checks (TC-ADM — route-level)'),
    p(
      'For each module: navigate to the URL, assert URL pattern, assert HTTP status below 400 when a response exists, and assert substantial visible text in the document. This is regression-style coverage of routing and primary rendering; it does not prove every grid, filter, export, or API payload.'
    ),
    h2('3.3 UI unit checks (UNIT-UI — Playwright)'),
    p(
      'Per route, isolated UI assertions: global brand text (DesignCentura) and presence of a dashboard navigation link. These are “UI unit” checks in the sense of small, repeatable assertions on a loaded page—not developer Jest tests of React components in isolation.'
    ),
    h2('3.4 Stress checks (STRESS — Playwright)'),
    p(
      'STRESS-001: sequential full cycles over all admin routes (configurable STRESS_LOOPS). STRESS-002: two different URLs opened in parallel tabs on the same session. STRESS-003: rapid burst reloads on dashboard (STRESS_BURST). STRESS-004: parallel fan-out across the first routes. These probe timing and concurrency at a browser level; they are not a substitute for k6/Gatling against APIs at thousands of RPS.'
    ),
    h2('3.5 Code unit tests (Node — lib/)'),
    p(
      'Pure-JavaScript helpers (e.g. HTTP range checks, route key parsing) are verified with `node --test` via `npm run test:unit`. Results do not appear in the Playwright JSON/CSV export; include them in release notes when required.'
    ),

    h1('4. Stability assessment'),
    p(
      failed === 0
        ? 'Within this run configuration, regression, UI unit, and configured stress checks completed without failure. That increases confidence in navigation and shell stability under the exercised patterns; it does not prove database or business-rule correctness.'
        : 'Stability cannot be claimed for the full admin experience until failures are triaged. Assume elevated risk for the affected flows until fixed and re-verified.'
    ),

    ...perModuleBlocks,

    h1('6. Cross-cutting faults (any CRM, including when regression + UI unit + stress all pass)'),
    p('Typical CRM/SaaS risks not fully covered by regression + UI unit + Playwright stress alone include:'),
    p(
      '• Session and roles: silent expiry, permission drift, or role-specific defects visible only to certain users.'
    ),
    p(
      '• API vs UI mismatch: pages render while APIs return partial errors, empty lists, or stale aggregates.'
    ),
    p(
      '• Data and workflow integrity: incorrect totals, broken approvals, duplicate records—requires domain and DB-level tests.'
    ),
    p(
      '• Performance at scale: enterprise load belongs in k6, Gatling, or cloud soak tests against APIs and browsers at scale. Playwright stress here is an extra signal, not a capacity proof.'
    ),
    p('• Security: authorization bypass, IDOR, XSS/CSRF require dedicated security testing.'),
    p('• Integrations: payments, email, webhooks, and third-party sync can fail independently of admin page loads.'),

    h1('7. Limitations of this automation pack'),
    p(
      'Flows are read-oriented for safety: no deliberate mass data mutation. Business rules on forms, reporting accuracy, and audit log semantics are not exhaustively proven. Use Playwright artefacts (screenshots, traces) for UI diagnosis when issues appear.'
    ),

    h1('8. Recommendations to set the CRM up for stronger quality'),
    p('• Align Section 5 improvements with roadmap owners (Payments, Leads, Briefs, Chat, Audit).'),
    p('• Document login and critical selectors; update automation when the UI changes.'),
    p('• Monitor 5xx, latency, and auth errors on APIs backing /crm-pay/admin/*.'),
    p('• In CI, run `npm run test:all` so Node unit tests (lib/) and Playwright (regression + UI unit + stress) both gate merges.'),
    p('• Prefer non-production automation accounts; if production is unavoidable, align MFA, IP allowlists, and least privilege.'),
    p('• Archive HTML reports per release candidate for auditability.'),

    h1('9. Evidence and artefacts'),
    p(
      'Playwright HTML report: reports/html-report. Screenshots (when enabled) and traces on failure: test-results/. Tabular extracts: reports/designcentura-test-run.csv and .json.'
    ),

    h1('10. Run outcome snapshot'),
    summaryTable,
  ];

  if (failedRows.length > 0) {
    children.push(h1('11. Blocking defects observed'));
    children.push(p('Use error text plus Playwright trace for solid reproduction.'));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1 },
          bottom: { style: BorderStyle.SINGLE, size: 1 },
          left: { style: BorderStyle.SINGLE, size: 1 },
          right: { style: BorderStyle.SINGLE, size: 1 },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
          insideVertical: { style: BorderStyle.SINGLE, size: 1 },
        },
        rows: [
          new TableRow({
            children: ['Area / test', 'Status', 'Error / symptom (excerpt)'].map(
              (h) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                })
            ),
          }),
          ...failedRows.map(
            (r) =>
              new TableRow({
                children: [r.title || r.tcId, r.status, (r.error || r.actual || '').slice(0, 2000)].map(
                  (cell) =>
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: String(cell) })] })],
                    })
                ),
              })
          ),
        ],
      })
    );
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  fs.mkdirSync(path.dirname(outDocx), { recursive: true });
  const buf = await Packer.toBuffer(doc);
  try {
    fs.writeFileSync(outDocx, buf);
    // eslint-disable-next-line no-console
    console.log('Wrote', outDocx);
  } catch (e) {
    if (e && e.code === 'EBUSY') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const alt = path.join(path.dirname(outDocx), `Designcentura-CRM-QA-Report-${stamp}.docx`);
      fs.writeFileSync(alt, buf);
      // eslint-disable-next-line no-console
      console.log('Wrote', alt, '(Word had file locked — close .docx files and use this copy)');
    } else throw e;
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
